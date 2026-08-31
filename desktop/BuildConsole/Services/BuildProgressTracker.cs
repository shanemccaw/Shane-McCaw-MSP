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

        /// <summary>
        /// Git #1251 — true once this build has reported its OWN progress via
        /// shaneapp://reportProgress / report-progress.mjs (an explicit agent call). The checklist
        /// auto-bridge (<see cref="BuildProgressTracker.BridgeFromChecklist"/>) defers to it: once a
        /// build reports for itself, the synthesized checklist-derived progress stands down so the
        /// two never fight over this panel. A build that never reports keeps this false and is driven
        /// entirely by the bridge.
        ///
        /// Git #1799 — this is a time-bounded lockout, not a permanent one. See
        /// <see cref="ExplicitReportIsActive"/>: once <see cref="StaleThreshold"/> has passed since
        /// the last explicit call, the lockout lapses and the bridge is allowed to take back over,
        /// so a build that reports once early and then goes quiet doesn't freeze the panel forever.
        /// The flag itself is left set (it still records "this build has ever self-reported"); only
        /// its enforcement in <see cref="BuildProgressTracker.Report"/> is time-bounded.
        /// </summary>
        public bool HasExplicitReport { get; set; }

        /// <summary>
        /// Git #1799 — whether the explicit-report lockout is still in force right now. True only
        /// while <see cref="HasExplicitReport"/> is set AND the last report (of either kind) landed
        /// within <see cref="StaleThreshold"/>. Reuses the exact same staleness window the "no
        /// progress update in Xm" warning already keys off, rather than inventing a second duration.
        /// </summary>
        public bool ExplicitReportIsActive => HasExplicitReport && TimeSinceLastReport < StaleThreshold;

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

        /// <summary>Cap on retained step history — bounds the progress panel's rows. The checklist
        /// bridge (Git #1251) can emit many small updates as a plan fills in and ticks over, so keep
        /// only the most recent entries; explicit reporting rarely exceeds a handful anyway.</summary>
        private const int MaxHistory = 15;

        /// <param name="isExplicit">
        /// True for a real agent-originated report (shaneapp://reportProgress / report-progress.mjs)
        /// — the default, so every existing caller marks the build as self-reporting. False only for
        /// the Git #1251 checklist auto-bridge (<see cref="BridgeFromChecklist"/>), which is ignored
        /// once a build has ever reported for itself — explicit always wins.
        /// </param>
        public static BuildProgressReport Report(int queueItemId, int step, int total, string label, bool isExplicit = true)
        {
            var report = _reports.GetOrAdd(queueItemId, id => new BuildProgressReport
            {
                QueueItemId = id,
                StartedAtUtc = DateTime.UtcNow
            });

            // Git #1251 / #1252 / #1799 — Allow checklist-bridge and explicit reportProgress updates
            // to coexist, but while a build's explicit reporting is still active (see
            // ExplicitReportIsActive), the checklist-derived progress stands down so they don't fight
            // and cause values/totals to jump back and forth. This lockout is time-bounded, not
            // permanent: it reuses the same StaleThreshold the "no progress update in Xm" warning
            // already keys off, so a build that reports once early and then goes quiet no longer
            // freezes the panel forever — once that window lapses, the bridge resumes driving the
            // display from the agent's real, ongoing checklist activity. A fresh explicit call always
            // re-arms the lockout immediately (isExplicit still wins in real time).
            if (isExplicit)
            {
                report.HasExplicitReport = true;
            }
            else if (report.ExplicitReportIsActive)
            {
                return report;
            }

            string trimmedLabel = label?.Trim() ?? string.Empty;

            // Whether this call represents a genuinely new milestone — the SAME criterion the
            // history-dedupe below uses — decided BEFORE any state is mutated, so the effective-step
            // derivation right after can tell "new checkpoint" from "duplicate re-report" apart.
            bool isNewMilestone = report.History.Count == 0
                || report.History[^1].Step != step
                || report.History[^1].Label != trimmedLabel;

            // Git #2033 — self-heal a stuck explicit step. If an agent calls reportProgress once per
            // phase with a fresh label each time but never advances `step` (e.g. always passing
            // step=0), this must not freeze the top progress bar while its own checklist history
            // genuinely grows — the history already advances correctly (see the dedupe below, keyed
            // on label change), only report.Step was wired straight to the raw, possibly-stuck agent
            // value. Derive a floor from the count of distinct milestones already recorded (own +1
            // when this call itself adds a new one) that never regresses and never sits below real
            // progress already made. The raw agent value always wins when it's already correct or
            // higher — this only kicks in when it's stuck. Left off the checklist-bridge path
            // (isExplicit=false): that path already computes a real done/total from actual checklist
            // state, where a genuine "0 of N done" is not a stuck value to correct.
            int effectiveStep = step;
            if (isExplicit)
            {
                int historyFloor = report.History.Count + (isNewMilestone ? 1 : 0);
                effectiveStep = Math.Max(step, historyFloor);
            }

            report.Step = effectiveStep;
            report.Total = Math.Max(total, effectiveStep);
            report.CurrentLabel = trimmedLabel;
            report.LastReportedAtUtc = DateTime.UtcNow;

            // Mark previous steps in history as not current
            foreach (var h in report.History) h.IsCurrent = false;

            // Add step to history if not duplicate of last step. History rows deliberately keep the
            // RAW `step` (not `effectiveStep`) so `isNewMilestone`'s dedupe comparison above stays
            // raw-vs-raw on the next call — comparing it against the corrected value would make every
            // call look "new" forever once a single correction has made report.Step diverge from the
            // agent's own raw step.
            if (isNewMilestone)
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

            // Bound the retained history (Git #1251 — the bridge can emit many small updates).
            if (report.History.Count > MaxHistory)
                report.History.RemoveRange(0, report.History.Count - MaxHistory);

            string est = report.EstimatedRemainingText;
            string src = isExplicit ? "reportProgress" : "checklist-bridge";
            // Keep the raw agent-supplied step visible in the log even when the effective step above
            // overrode it — this is the diagnostic trail for #2033, not just the corrected display value.
            string stepLog = effectiveStep != step ? $"{effectiveStep}/{report.Total} (raw step={step})" : $"{effectiveStep}/{report.Total}";
            ActivityLog.Log(LogChannel,
                $"[{src}] build #{queueItemId}: step {stepLog} ({report.Percent:0}%) — '{report.CurrentLabel}' [{est}]");

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

        /// <summary>
        /// Git #1251 — synthesize a progress report from an agent's OWN free-form checklist (the
        /// ☐ / - [ ] / - [x] / ✅ markers Build Watch already sees streaming past), for the very
        /// common case where a session keeps a checklist in chat but never calls reportProgress.
        /// #1206 strengthened the instruction to "report at every checkpoint" and it still didn't
        /// stick, so this stops relying on the agent's compliance: <paramref name="doneCount"/> of
        /// <paramref name="totalCount"/> detected items becomes step/total, advancing the same panel
        /// #1206 built. An explicit reportProgress call takes precedence in real time — while a
        /// build's explicit reporting is still active (<see cref="BuildProgressReport.ExplicitReportIsActive"/>),
        /// this is a no-op (see <see cref="Report"/>'s isExplicit guard). Git #1799 — that precedence
        /// is time-bounded: once explicit reporting has gone stale for longer than
        /// <see cref="BuildProgressReport.StaleThreshold"/>, this bridge resumes driving the panel
        /// from the checklist instead of leaving it frozen at the last explicit value forever.
        /// Returns the updated report, or null when there's nothing to report or explicit is still active.
        /// </summary>
        public static BuildProgressReport? BridgeFromChecklist(int queueItemId, int doneCount, int totalCount, string label)
        {
            if (totalCount <= 0) return null;
            return Report(queueItemId, Math.Clamp(doneCount, 0, totalCount), totalCount, label, isExplicit: false);
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

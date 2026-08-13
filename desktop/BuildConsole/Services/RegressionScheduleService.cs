using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Threading;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #967 (Epic #803) — background scheduler that runs the FULL regression suite
    /// (test-manifests/_regression-suite.json) on a configurable interval and, ONLY when
    /// something fails, fires an admin web-push alert naming the failing manifest/step with
    /// a link back into the app. A fully passing scheduled run is silent (no push) — Shane's
    /// ask on #967: "know automatically if something breaks", not a ping on every green run.
    ///
    /// Mirrors <see cref="ReplitWatcherService"/>'s shape verbatim (a DispatcherTimer, a
    /// _busy re-entrancy flag, and an ApplyConfig() that reads Settings and starts/stops
    /// live) — reusing the app's one established polling pattern, not a new mechanism.
    ///
    /// It deliberately doesn't know HOW to run the suite or send the push: MainWindow injects
    /// a runSuite delegate (its existing RunRegressionSuiteCollectAsync, which drives the one
    /// shared WebView2 TestRunnerWindow — hence this timer runs on the UI thread) and a
    /// sendAlert delegate (BuildTrackerApiClient.SendTestAlertAsync → POST
    /// /admin/deploy/test-alert → sendWebPushToAdmins). This keeps MainWindow's footprint tiny
    /// and this class free of UI/HTTP specifics.
    /// </summary>
    public class RegressionScheduleService
    {
        private const string Channel = "testing.scheduled-run";

        private readonly DispatcherTimer _timer;
        private bool _busy;
        private readonly Func<Task<List<ManifestRunResult>>> _runSuiteAsync;
        private readonly Func<string, string, string, Task<bool>> _sendAlertAsync;

        public RegressionScheduleService(
            Func<Task<List<ManifestRunResult>>> runSuiteAsync,
            Func<string, string, string, Task<bool>> sendAlertAsync)
        {
            _runSuiteAsync = runSuiteAsync;
            _sendAlertAsync = sendAlertAsync;
            _timer = new DispatcherTimer();
            _timer.Tick += async (_, _) => await TickAsync();
        }

        /// <summary>Reads current Settings and (re)starts or stops the timer accordingly.
        /// Called once at startup and again whenever Settings are saved, so toggling on/off
        /// and changing the interval take effect without a restart. Unlike the Replit watcher
        /// it deliberately does NOT kick an immediate run — a full-suite sweep pops the shared
        /// WebView2 runner and would be disruptive to fire on every app-start / settings-save;
        /// the first run lands one interval out.</summary>
        public void ApplyConfig()
        {
            var s = BuildConsoleSettings.Load();
            _timer.Stop();

            if (!s.ScheduledRegressionEnabled)
            {
                ActivityLog.Log(Channel, "Scheduler OFF (Settings > Test Environment). No unattended runs.");
                return;
            }

            int hours = Math.Max(1, s.ScheduledRegressionIntervalHours);
            _timer.Interval = TimeSpan.FromHours(hours);
            _timer.Start();
            ActivityLog.Log(Channel,
                $"Scheduler ARMED — full regression suite every {hours}h; push-on-failure={s.PushOnRegressionFailure}. First run in {hours}h.");
        }

        private async Task TickAsync()
        {
            // A full-suite sweep can outlast the interval; never let ticks stack.
            if (_busy) return;

            var s = BuildConsoleSettings.Load();
            if (!s.ScheduledRegressionEnabled)
            {
                _timer.Stop();
                return;
            }

            _busy = true;
            var startedAt = DateTime.Now;
            try
            {
                ActivityLog.Log(Channel, "Scheduled regression run STARTED (full _regression-suite.json sweep).");

                List<ManifestRunResult> results = await _runSuiteAsync();
                double elapsed = (DateTime.Now - startedAt).TotalSeconds;

                var failed = results.Where(r => !r.AllPassed).ToList();
                if (failed.Count == 0)
                {
                    // Silent success — log only, never push (#967 requirement 4).
                    ActivityLog.Log(Channel,
                        $"Scheduled run FINISHED — all {results.Count} manifest(s) passed in {elapsed:F0}s. Silent (no alert on success).");
                    return;
                }

                // Name the first failing manifest + step in the alert; count the rest.
                var firstFail = failed[0];
                var firstStep = firstFail.Steps.FirstOrDefault(st => !st.Passed);
                string stepLabel = firstStep?.Label ?? "(no steps ran)";

                string title = failed.Count == 1
                    ? "❌ Scheduled test run: 1 manifest failing"
                    : $"❌ Scheduled test run: {failed.Count} manifests failing";

                string more = failed.Count > 1 ? $" (+{failed.Count - 1} more failing)" : "";
                string detail = firstStep != null && !string.IsNullOrWhiteSpace(firstStep.Detail)
                    ? $" — {Truncate(firstStep.Detail, 140)}"
                    : "";
                string body = $"{firstFail.Feature} (#{firstFail.Issue}): step '{stepLabel}' failed{detail}{more}";

                ActivityLog.Log(Channel,
                    $"Scheduled run FINISHED — {failed.Count}/{results.Count} manifest(s) FAILED in {elapsed:F0}s. {body}");

                if (!s.PushOnRegressionFailure)
                {
                    ActivityLog.Log(Channel, "Push-on-failure is OFF in Settings — alert suppressed (logged only).");
                    return;
                }

                // Deep-link at the adminv2 Git/Deploy screen — the closest web review surface
                // for a failed run (Deploy Console + run history); the results themselves also
                // land in test-results/*.json locally.
                bool delivered = await _sendAlertAsync(title, body, "/adminv2/git");
                ActivityLog.Log(Channel, delivered
                    ? "Failure alert PUSHED to admins (sendWebPushToAdmins via /admin/deploy/test-alert)."
                    : "Failure alert NOT sent — api-server unreachable or Build Tracker not configured (scripts\\build-queue-watcher.config.json).");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Scheduled run ERRORED: {ex.Message}");
            }
            finally
            {
                _busy = false;
            }
        }

        private static string Truncate(string s, int max) =>
            string.IsNullOrEmpty(s) || s.Length <= max ? s : s.Substring(0, max) + "…";
    }
}

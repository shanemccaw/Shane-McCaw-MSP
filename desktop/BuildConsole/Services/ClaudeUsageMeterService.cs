using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    public enum ClaudeUsageMeterState
    {
        /// <summary>Between polls with a good last reading — the number shown is real.</summary>
        Ok,
        /// <summary>Actively polling claude CLI / usage page right now.</summary>
        Polling,
        /// <summary>Usage could not be read (not logged in, or CLI unavailable) — show a muted "Claude: --" rather than a stale/guessed number.</summary>
        Unavailable,
        /// <summary>Check threw or failed.</summary>
        Error,
    }

    /// <summary>A status snapshot pushed to whoever renders the indicator (the MainWindow status bar). DisplayText/ToolTip are fully computed here so the UI just renders them.</summary>
    public class ClaudeUsageStatus
    {
        public ClaudeUsageMeterState State { get; set; } = ClaudeUsageMeterState.Unavailable;
        /// <summary>Whole-number usage percentage (0–100), or null when it couldn't be read.</summary>
        public int? Percent { get; set; }
        /// <summary>The next reset moment as a LOCAL datetime, parsed from the "Resets …" label, or null when it couldn't be parsed.</summary>
        public DateTime? ResetTarget { get; set; }
        /// <summary>Fully-formed status-bar text, e.g. "Claude: 87% used — resets in 1d 4h 12m", "Claude: 45% used", or "Claude: --".</summary>
        public string DisplayText { get; set; } = "Claude: --";
        public string ToolTip { get; set; } = string.Empty;
        
        // Weekly (All Models) status fields
        public int? WeeklyPercent { get; set; }
        public DateTime? WeeklyResetTarget { get; set; }
        public string WeeklyDisplayText { get; set; } = "Claude Weekly: --";
        public string WeeklyToolTip { get; set; } = string.Empty;

        public DateTime? LastPoll { get; set; }
    }

    /// <summary>
    /// Background watcher that keeps a live Claude usage percentage in the status bar.
    ///
    /// Fast &amp; reliable CLI-first architecture:
    /// Spawns `claude.exe -p --no-session-persistence "/usage"` with redirected standard input
    /// (closed immediately), returning direct usage statistics in ~2 seconds without web scraping.
    ///
    /// Specifically extracts the "All Models" progress percentage (ignoring "Current session"
    /// and "Fable" progress bars), parses the reset target timestamp into local time, and
    /// feeds live countdown and rate-of-growth projection models.
    ///
    /// If the CLI is unavailable or fails, falls back gracefully to the WebView2 session probe.
    ///
    /// Logging channel: "usage-meter" via ActivityLog.Log — every poll attempt, success, and failure.
    /// </summary>
    public class ClaudeUsageMeterService
    {
        public const string Channel = "usage-meter";

        public const string UsageUrl = "https://claude.ai/new#settings/usage";

        /// <summary>Poll cadence for automatic background usage checks.</summary>
        private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(10);

        /// <summary>How often the visible countdown re-renders between polls. Only the text ticks; the percentage is untouched until the next real poll.</summary>
        private static readonly TimeSpan DisplayTickInterval = TimeSpan.FromSeconds(30);

        /// <summary>At/above this usage the countdown is shown alongside the percentage; below it, just the plain percentage.</summary>
        private const int CountdownThresholdPercent = 85;

        private const int NavigationTimeoutMs = 20000;
        private const int HydrationMaxWaitMs = 15000;
        private const int HydrationPollIntervalMs = 400;
        private const int PostMeterSettleMs = 400;

        private readonly WebView2? _webView;
        private readonly Func<WebView2, Task<bool>>? _ensureInitialized;
        private readonly DispatcherTimer _pollTimer;
        private readonly DispatcherTimer _displayTimer;

        private bool _busy;
        private int? _percent;
        private DateTime? _resetTarget;
        private DateTime? _lastPoll;
        private ClaudeUsageMeterState _lastState = ClaudeUsageMeterState.Unavailable;

        private int? _weeklyPercent;
        private DateTime? _weeklyResetTarget;
        private DateTime? _weeklyProjectedFullTarget;
        private double _weeklyProjectedRatePerHour;

        // ── projected "time until 100%" (real observed growth rate, current window only) ──
        private DateTime? _projectedFullTarget;
        private double _projectedRatePerHour;

        public event Action<ClaudeUsageStatus>? StatusChanged;

        public ClaudeUsageMeterService(WebView2? webView = null, Func<WebView2, Task<bool>>? ensureInitialized = null)
        {
            _webView = webView;
            _ensureInitialized = ensureInitialized;

            _pollTimer = new DispatcherTimer { Interval = PollInterval };
            _pollTimer.Tick += async (_, _) => await TickAsync();

            _displayTimer = new DispatcherTimer(DispatcherPriority.Background) { Interval = DisplayTickInterval };
            _displayTimer.Tick += (_, _) => OnDisplayTick();
        }

        /// <summary>Starts the poll + display timers and fires the first poll immediately.</summary>
        public void Start()
        {
            _pollTimer.Start();
            _displayTimer.Start();
            Emit(ClaudeUsageMeterState.Polling);
            ActivityLog.Log(Channel, $"Started — polling Claude usage (CLI-first, All Models tier) every {PollInterval.TotalMinutes:0} min; countdown shown at ≥{CountdownThresholdPercent}%.");
            _ = TickAsync();
        }

        public void Stop()
        {
            _pollTimer.Stop();
            _displayTimer.Stop();
        }

        /// <summary>Manual on-demand poll, e.g. the status bar's refresh icon.</summary>
        public async Task ManualRefreshAsync()
        {
            if (_busy)
            {
                ActivityLog.Log(Channel, "Manual refresh requested — ignored, a poll is already in flight.");
                return;
            }
            ActivityLog.Log(Channel, "Manual refresh requested (status bar refresh icon).");
            await TickAsync();
        }

        /// <summary>One real poll: first tries the CLI `claude -p /usage` (fast, 2s, exact All Models tier), then falls back to WebView2 if needed.</summary>
        private async Task TickAsync()
        {
            if (_busy) return;
            _busy = true;
            try
            {
                Emit(ClaudeUsageMeterState.Polling);

                // ── Phase 1: Fast CLI Execution ─────────────────────────────
                var (cliSuccess, cliOutput, cliError) = await RunClaudeCliUsageAsync();
                if (cliSuccess && !string.IsNullOrWhiteSpace(cliOutput))
                {
                    var (parsedSessionPercent, parsedSessionReset, parsedWeeklyPercent, parsedWeeklyReset) = ParseCliUsageOutput(cliOutput);
                    if (parsedSessionPercent.HasValue || parsedWeeklyPercent.HasValue)
                    {
                        _percent = parsedSessionPercent;
                        _resetTarget = ParseResetTarget(parsedSessionReset);
                        _weeklyPercent = parsedWeeklyPercent;
                        _weeklyResetTarget = ParseResetTarget(parsedWeeklyReset);
                        _lastPoll = DateTime.Now;

                        ActivityLog.Log(Channel,
                            $"OK[cli] — Session: {_percent}% used (reset target={(_resetTarget.HasValue ? _resetTarget.Value.ToString("ddd HH:mm") : "unparsed")}), " +
                            $"Weekly: {_weeklyPercent}% used (reset target={(_weeklyResetTarget.HasValue ? _weeklyResetTarget.Value.ToString("ddd HH:mm") : "unparsed")}).");

                        if (_percent.HasValue)
                            UpdateProjection(_percent.Value, _resetTarget, _lastPoll.Value);
                        if (_weeklyPercent.HasValue)
                            UpdateWeeklyProjection(_weeklyPercent.Value, _weeklyResetTarget, _lastPoll.Value);

                        Emit(ClaudeUsageMeterState.Ok);
                        return;
                    }
                    else
                    {
                        ActivityLog.Log(Channel, $"CLI returned output but no usage meters could be parsed. Output: {Trim(cliOutput)}");
                    }
                }
                else
                {
                    ActivityLog.Log(Channel, $"CLI poll not available or returned error: {cliError}. Falling back to WebView2 if available.");
                }

                // ── Phase 2: Fallback WebView2 Probe ─────────────────────────
                if (_webView == null || _ensureInitialized == null)
                {
                    SetUnavailable(string.IsNullOrWhiteSpace(cliError) ? "Claude CLI unavailable" : cliError);
                    return;
                }

                if (!await _ensureInitialized(_webView) || _webView.CoreWebView2 == null)
                {
                    ActivityLog.Log(Channel, "WebView2 fallback skipped — background WebView2 failed to initialise.");
                    SetUnavailable("WebView2 not ready");
                    return;
                }

                ActivityLog.Log(Channel, $"Polling fallback {UsageUrl} via WebView2 …");

                if (!await NavigateAsync(UsageUrl))
                {
                    ActivityLog.Log(Channel, "FAIL[navigation] — the usage page never reported NavigationCompleted.");
                    SetUnavailable("usage page did not load");
                    return;
                }

                var probe = await WaitForHydrationAsync();
                _lastPoll = DateTime.Now;

                if (probe == null)
                {
                    ActivityLog.Log(Channel, "FAIL[probe] — in-page script evaluation failed.");
                    SetUnavailable("page not readable");
                    return;
                }

                if (probe.AuthWall)
                {
                    ActivityLog.Log(Channel,
                        $"FAIL[auth-wall] — page looks like a login wall. url=\"{Trim(probe.Url)}\", meters={probe.MeterCount}. Sign in to claude.ai in a normal tab.");
                    SetUnavailable("hit a login/auth wall — sign in to claude.ai");
                    return;
                }

                if (probe.MeterCount == 0)
                {
                    ActivityLog.Log(Channel, $"FAIL[meter-not-found] — [role=\"meter\"] never appeared after {HydrationMaxWaitMs}ms.");
                    SetUnavailable("meter not found on usage page");
                    return;
                }

                var reading = ExtractReading(probe);
                if (reading.SessionPercent == null && reading.WeeklyPercent == null)
                {
                    ActivityLog.Log(Channel, $"FAIL[meter-malformed] — found {probe.MeterCount} meter(s) but none had parseable values: {DescribeMeters(probe)}");
                    SetUnavailable("meter present but value unreadable");
                    return;
                }

                _percent = reading.SessionPercent;
                _resetTarget = ParseResetTarget(reading.SessionResetLabel);
                _weeklyPercent = reading.WeeklyPercent;
                _weeklyResetTarget = ParseResetTarget(reading.WeeklyResetLabel);

                ActivityLog.Log(Channel,
                    $"OK[read] — Session: {_percent}% (valuetext=\"{reading.SessionValueText}\"), " +
                    $"Weekly: {_weeklyPercent}% (valuetext=\"{reading.WeeklyValueText}\").");

                if (_percent.HasValue)
                    UpdateProjection(_percent.Value, _resetTarget, _lastPoll.Value);
                if (_weeklyPercent.HasValue)
                    UpdateWeeklyProjection(_weeklyPercent.Value, _weeklyResetTarget, _lastPoll.Value);

                Emit(ClaudeUsageMeterState.Ok);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Poll threw: {ex.Message}");
                SetUnavailable(ex.Message, ClaudeUsageMeterState.Error);
            }
            finally
            {
                _busy = false;
            }
        }

        /// <summary>Fast between-poll tick: updates live countdown text without re-polling.</summary>
        private void OnDisplayTick()
        {
            if (_lastState != ClaudeUsageMeterState.Ok) return;

            bool resetCountdownShown = (_percent.HasValue && _percent.Value >= CountdownThresholdPercent && _resetTarget.HasValue) ||
                                       (_weeklyPercent.HasValue && _weeklyPercent.Value >= CountdownThresholdPercent && _weeklyResetTarget.HasValue);
            bool projectionShown = _projectedFullTarget.HasValue || _weeklyProjectedFullTarget.HasValue;
            if (resetCountdownShown || projectionShown)
                Emit(ClaudeUsageMeterState.Ok);
        }

        private void SetUnavailable(string reason, ClaudeUsageMeterState state = ClaudeUsageMeterState.Unavailable)
        {
            _percent = null;
            _resetTarget = null;
            _projectedFullTarget = null;
            _projectedRatePerHour = 0;
            _weeklyPercent = null;
            _weeklyResetTarget = null;
            _weeklyProjectedFullTarget = null;
            _weeklyProjectedRatePerHour = 0;
            Emit(state, reason);
        }

        // ── CLI Execution & Parsing ─────────────────────────────────────────

        /// <summary>Resolves path to the installed `claude.exe` CLI.</summary>
        internal static string ResolveClaudeExe()
        {
            string userProfileExe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", "claude.exe");
            if (File.Exists(userProfileExe)) return userProfileExe;

            string? pathVar = Environment.GetEnvironmentVariable("PATH");
            if (!string.IsNullOrEmpty(pathVar))
            {
                foreach (var part in pathVar.Split(Path.PathSeparator))
                {
                    if (string.IsNullOrWhiteSpace(part)) continue;
                    string candidate = Path.Combine(part.Trim(), "claude.exe");
                    if (File.Exists(candidate)) return candidate;
                }
            }
            return userProfileExe;
        }

        /// <summary>Spawns `claude.exe -p --no-session-persistence "/usage"` with immediate stdin close and 20s timeout.</summary>
        private async Task<(bool success, string output, string error)> RunClaudeCliUsageAsync()
        {
            string exe = ResolveClaudeExe();
            if (!File.Exists(exe))
            {
                return (false, string.Empty, $"claude.exe not found at {exe}");
            }

            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = "--safe-mode -p --no-session-persistence \"/usage\"",
                WorkingDirectory = BuildTrackerConfig.FindRepoRoot() ?? Path.GetDirectoryName(exe),
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.Environment.Remove("ELECTRON_RUN_AS_NODE");

            using var process = new Process { StartInfo = psi };
            try
            {
                process.Start();
                // Close standard input immediately so claude CLI proceeds without waiting
                process.StandardInput.Close();

                var outputTask = process.StandardOutput.ReadToEndAsync();
                var errorTask = process.StandardError.ReadToEndAsync();

                var completedTask = await Task.WhenAny(
                    Task.WhenAll(outputTask, errorTask),
                    Task.Delay(TimeSpan.FromSeconds(20))
                );

                if (completedTask != Task.WhenAll(outputTask, errorTask))
                {
                    try { process.Kill(entireProcessTree: true); } catch { }
                    return (false, string.Empty, "Timed out waiting for claude CLI after 20s");
                }

                await process.WaitForExitAsync();
                string output = await outputTask;
                string error = await errorTask;

                if (process.ExitCode != 0 && string.IsNullOrWhiteSpace(output))
                {
                    return (false, output, $"Exit code {process.ExitCode}: {error}");
                }

                return (true, output, error);
            }
            catch (Exception ex)
            {
                return (false, string.Empty, ex.Message);
            }
        }

        /// <summary>
        /// Parses the output of `claude -p /usage`, extracting both the **Current session**
        /// and the **All Models** tiers.
        ///
        /// Output example:
        /// "Current session: 7% used · resets Aug 23, 7:50pm (America/New_York)
        ///  Current week (all models): 99% used · resets Aug 23, 9pm (America/New_York)
        ///  Current week (Fable): 15% used · resets Aug 23, 9pm (America/New_York)"
        /// </summary>
        internal static (int? sessionPercent, string sessionReset, int? weeklyPercent, string weeklyReset) ParseCliUsageOutput(string output)
        {
            if (string.IsNullOrWhiteSpace(output)) return (null, string.Empty, null, string.Empty);

            int? sessionPercent = null;
            string sessionReset = string.Empty;
            int? weeklyPercent = null;
            string weeklyReset = string.Empty;

            var lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            foreach (var line in lines)
            {
                // 1. Current Session
                if (Regex.IsMatch(line, @"current\s+session", RegexOptions.IgnoreCase))
                {
                    var match = Regex.Match(line, @":\s*(\d+(?:\.\d+)?)\s*%\s*used(?:[^\r\n·]*·\s*resets?\s+([^\r\n]+))?", RegexOptions.IgnoreCase);
                    if (match.Success && double.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var p))
                    {
                        sessionPercent = Clamp(p);
                        sessionReset = match.Groups[2].Success ? match.Groups[2].Value.Trim() : string.Empty;
                    }
                }
                // 2. All Models (Weekly)
                else if (Regex.IsMatch(line, @"all\s+models?", RegexOptions.IgnoreCase))
                {
                    var match = Regex.Match(line, @":\s*(\d+(?:\.\d+)?)\s*%\s*used(?:[^\r\n·]*·\s*resets?\s+([^\r\n]+))?", RegexOptions.IgnoreCase);
                    if (match.Success && double.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var p))
                    {
                        weeklyPercent = Clamp(p);
                        weeklyReset = match.Groups[2].Success ? match.Groups[2].Value.Trim() : string.Empty;
                    }
                }
            }

            // Fallbacks: if we didn't find specific labels, let's look through all matches
            if (sessionPercent == null)
            {
                // First line if any
                foreach (var line in lines)
                {
                    if (Regex.IsMatch(line, @"session", RegexOptions.IgnoreCase))
                    {
                        var match = Regex.Match(line, @":\s*(\d+(?:\.\d+)?)\s*%\s*used(?:[^\r\n·]*·\s*resets?\s+([^\r\n]+))?", RegexOptions.IgnoreCase);
                        if (match.Success && double.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var p))
                        {
                            sessionPercent = Clamp(p);
                            sessionReset = match.Groups[2].Success ? match.Groups[2].Value.Trim() : string.Empty;
                            break;
                        }
                    }
                }
            }
            if (weeklyPercent == null)
            {
                foreach (var line in lines)
                {
                    if (Regex.IsMatch(line, @"all\s+models|week", RegexOptions.IgnoreCase))
                    {
                        var match = Regex.Match(line, @":\s*(\d+(?:\.\d+)?)\s*%\s*used(?:[^\r\n·]*·\s*resets?\s+([^\r\n]+))?", RegexOptions.IgnoreCase);
                        if (match.Success && double.TryParse(match.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var p))
                        {
                            weeklyPercent = Clamp(p);
                            weeklyReset = match.Groups[2].Success ? match.Groups[2].Value.Trim() : string.Empty;
                            break;
                        }
                    }
                }
            }

            // Absolute general fallback
            if (sessionPercent == null || weeklyPercent == null)
            {
                var matches = Regex.Matches(output, @"(?:([a-zA-Z\s()]+):)?\s*(\d+(?:\.\d+)?)\s*%\s*used(?:[^\r\n·]*·\s*resets?\s+([^\r\n·]+))?", RegexOptions.IgnoreCase);
                int foundCount = 0;
                foreach (Match m in matches)
                {
                    if (!m.Success) continue;
                    if (double.TryParse(m.Groups[2].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var p))
                    {
                        int val = Clamp(p);
                        string reset = m.Groups[3].Value.Trim();
                        if (foundCount == 0 && sessionPercent == null)
                        {
                            sessionPercent = val;
                            sessionReset = reset;
                        }
                        else if (weeklyPercent == null)
                        {
                            weeklyPercent = val;
                            weeklyReset = reset;
                        }
                        foundCount++;
                    }
                }
            }

            return (sessionPercent, sessionReset, weeklyPercent, weeklyReset);
        }

        // ── time-until-100% projection ──────────────────────────────────────

        private void UpdateProjection(int percent, DateTime? resetTarget, DateTime pollMoment)
        {
            try
            {
                var sample = new UsageSample { At = pollMoment, Percent = percent, ResetTarget = resetTarget };
                bool stored = UsageHistoryStore.Append(sample);
                ActivityLog.Log(Channel,
                    $"data-point {(stored ? "stored" : "NOT stored")}: {percent}% at {pollMoment:yyyy-MM-dd HH:mm:ss}"
                    + (resetTarget.HasValue ? $" (reset target {resetTarget.Value:ddd HH:mm})" : " (reset target unparsed)") + ".");

                var projection = UsageProjection.Compute(UsageHistoryStore.ReadAll(), pollMoment);
                if (projection.HasProjection && projection.TimeTo100.HasValue)
                {
                    _projectedFullTarget = pollMoment + projection.TimeTo100.Value;
                    _projectedRatePerHour = projection.RatePerHour;
                    ActivityLog.Log(Channel,
                        $"projection: ~{FormatCountdown(projection.TimeTo100.Value)} to 100% "
                        + $"(rate {projection.RatePerHour:0.00}%/hr over {projection.WindowSampleCount} current-window points; "
                        + $"projected 100% at {_projectedFullTarget.Value:ddd yyyy-MM-dd HH:mm}).");
                }
                else
                {
                    _projectedFullTarget = null;
                    _projectedRatePerHour = 0;
                    ActivityLog.Log(Channel, $"projection withheld: {projection.Reason}.");
                }
            }
            catch (Exception ex)
            {
                _projectedFullTarget = null;
                _projectedRatePerHour = 0;
                ActivityLog.Log(Channel, $"projection update failed: {ex.Message}");
            }
        }

        private void UpdateWeeklyProjection(int percent, DateTime? resetTarget, DateTime pollMoment)
        {
            try
            {
                var sample = new UsageSample { At = pollMoment, Percent = percent, ResetTarget = resetTarget };
                bool stored = WeeklyUsageHistoryStore.Append(sample);
                ActivityLog.Log(Channel,
                    $"weekly data-point {(stored ? "stored" : "NOT stored")}: {percent}% at {pollMoment:yyyy-MM-dd HH:mm:ss}"
                    + (resetTarget.HasValue ? $" (weekly reset target {resetTarget.Value:ddd HH:mm})" : " (weekly reset target unparsed)") + ".");

                var projection = UsageProjection.Compute(WeeklyUsageHistoryStore.ReadAll(), pollMoment);
                if (projection.HasProjection && projection.TimeTo100.HasValue)
                {
                    _weeklyProjectedFullTarget = pollMoment + projection.TimeTo100.Value;
                    _weeklyProjectedRatePerHour = projection.RatePerHour;
                    ActivityLog.Log(Channel,
                        $"weekly projection: ~{FormatCountdown(projection.TimeTo100.Value)} to 100% "
                        + $"(weekly rate {projection.RatePerHour:0.00}%/hr over {projection.WindowSampleCount} current-window points; "
                        + $"weekly projected 100% at {_weeklyProjectedFullTarget.Value:ddd yyyy-MM-dd HH:mm}).");
                }
                else
                {
                    _weeklyProjectedFullTarget = null;
                    _weeklyProjectedRatePerHour = 0;
                    ActivityLog.Log(Channel, $"weekly projection withheld: {projection.Reason}.");
                }
            }
            catch (Exception ex)
            {
                _weeklyProjectedFullTarget = null;
                _weeklyProjectedRatePerHour = 0;
                ActivityLog.Log(Channel, $"weekly projection update failed: {ex.Message}");
            }
        }

        // ── reset-label parsing ─────────────────────────────────────────────

        private static readonly Dictionary<string, int> MonthNames = new(StringComparer.OrdinalIgnoreCase)
        {
            { "jan", 1 }, { "january", 1 },
            { "feb", 2 }, { "february", 2 },
            { "mar", 3 }, { "march", 3 },
            { "apr", 4 }, { "april", 4 },
            { "may", 5 },
            { "jun", 6 }, { "june", 6 },
            { "jul", 7 }, { "july", 7 },
            { "aug", 8 }, { "august", 8 },
            { "sep", 9 }, { "september", 9 },
            { "oct", 10 }, { "october", 10 },
            { "nov", 11 }, { "november", 11 },
            { "dec", 12 }, { "december", 12 },
        };

        private static readonly (string abbr, DayOfWeek dow)[] Weekdays =
        {
            ("sun", DayOfWeek.Sunday), ("mon", DayOfWeek.Monday), ("tue", DayOfWeek.Tuesday),
            ("wed", DayOfWeek.Wednesday), ("thu", DayOfWeek.Thursday), ("fri", DayOfWeek.Friday),
            ("sat", DayOfWeek.Saturday),
        };

        /// <summary>
        /// <summary>
        /// Returns the upcoming Sunday 9:00 PM Eastern Time (America/New_York) reset moment,
        /// expressed in the user's LOCAL timezone.
        /// </summary>
        internal static DateTime GetNextWeeklyResetTarget(DateTime? nowOverride = null)
        {
            var now = nowOverride ?? DateTime.Now;
            var eastern = ResolveTimeZone("America/New_York");
            var nowEt = TimeZoneInfo.ConvertTime(now, TimeZoneInfo.Local, eastern);

            int daysUntilSunday = ((int)DayOfWeek.Sunday - (int)nowEt.DayOfWeek + 7) % 7;
            if (daysUntilSunday == 0 && (nowEt.Hour > 21 || (nowEt.Hour == 21 && nowEt.Minute > 0)))
            {
                daysUntilSunday = 7;
            }

            var nextSundayEt = new DateTime(nowEt.Year, nowEt.Month, nowEt.Day, 21, 0, 0, DateTimeKind.Unspecified).AddDays(daysUntilSunday);
            var nextSundayUtc = TimeZoneInfo.ConvertTimeToUtc(nextSundayEt, eastern);
            return TimeZoneInfo.ConvertTimeFromUtc(nextSundayUtc, TimeZoneInfo.Local);
        }

        /// <summary>
        /// Parses a reset string into a LOCAL datetime.
        /// Handles:
        /// - Date + Time + TimeZone: "Aug 23, 9pm (America/New_York)", "Aug 23, 7:50pm (America/New_York)", "Aug 23 21:00 (UTC)"
        /// - Weekday + Time: "Resets Sun 9:00 PM", "Sunday 9pm ET"
        /// - Bare Time: "9:00 PM", "21:00", "1:00 AM" (UTC reset time)
        /// </summary>
        internal static DateTime? ParseResetTarget(string? label, DateTime? nowOverride = null)
        {
            var now = nowOverride ?? DateTime.Now;
            if (string.IsNullOrWhiteSpace(label)) return GetNextWeeklyResetTarget(now);
            string lower = label.ToLowerInvariant();

            // 1. Month Date + Time: "Aug 23, 9pm (America/New_York)" / "Aug 23, 7:50pm" / "August 23 21:00 (UTC)"
            var fullDateMatch = Regex.Match(lower, @"([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?");
            if (fullDateMatch.Success && MonthNames.TryGetValue(fullDateMatch.Groups[1].Value, out int month))
            {
                int day = int.Parse(fullDateMatch.Groups[2].Value);
                int hour = int.Parse(fullDateMatch.Groups[3].Value);
                int minute = fullDateMatch.Groups[4].Success ? int.Parse(fullDateMatch.Groups[4].Value) : 0;
                string mer = fullDateMatch.Groups[5].Value;
                if (mer == "pm" && hour < 12) hour += 12;
                else if (mer == "am" && hour == 12) hour = 0;

                string tzName = fullDateMatch.Groups[6].Success ? fullDateMatch.Groups[6].Value.Trim() : string.Empty;
                
                // If tzName was not in parens, check if the string contains a trailing timezone indicator
                if (string.IsNullOrWhiteSpace(tzName))
                {
                    if (lower.Contains("utc") || lower.Contains("gmt")) tzName = "utc";
                    else if (lower.Contains("et") || lower.Contains("est") || lower.Contains("edt") || lower.Contains("eastern")) tzName = "America/New_York";
                    else if (lower.Contains("pt") || lower.Contains("pst") || lower.Contains("pdt") || lower.Contains("pacific")) tzName = "America/Los_Angeles";
                    else if (lower.Contains("ct") || lower.Contains("cst") || lower.Contains("cdt") || lower.Contains("central")) tzName = "America/Chicago";
                }

                // If no timezone is specified and hour is 1am / 01:00 (standard UTC reset time for 9pm ET), treat as UTC
                TimeZoneInfo sourceTz;
                if (string.IsNullOrWhiteSpace(tzName))
                {
                    sourceTz = (hour == 1 && minute == 0) ? TimeZoneInfo.Utc : ResolveTimeZone("America/New_York");
                }
                else
                {
                    sourceTz = ResolveTimeZone(tzName);
                }

                int year = now.Year;
                try
                {
                    var sourceDt = new DateTime(year, month, day, hour, minute, 0, DateTimeKind.Unspecified);
                    var sourceUtc = TimeZoneInfo.ConvertTimeToUtc(sourceDt, sourceTz);
                    var localTarget = TimeZoneInfo.ConvertTimeFromUtc(sourceUtc, TimeZoneInfo.Local);

                    // If candidate was in the past by more than 180 days (e.g. year turnover), advance year
                    if (localTarget < now.AddDays(-180))
                    {
                        sourceDt = new DateTime(year + 1, month, day, hour, minute, 0, DateTimeKind.Unspecified);
                        sourceUtc = TimeZoneInfo.ConvertTimeToUtc(sourceDt, sourceTz);
                        localTarget = TimeZoneInfo.ConvertTimeFromUtc(sourceUtc, TimeZoneInfo.Local);
                    }
                    return localTarget;
                }
                catch { }
            }

            // 2. Weekday + Time: "Resets Sun 9:00 PM", "Sunday 9pm ET"
            var tm = Regex.Match(lower, @"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?");
            if (tm.Success)
            {
                int thour = int.Parse(tm.Groups[1].Value);
                int tminute = tm.Groups[2].Success ? int.Parse(tm.Groups[2].Value) : 0;
                string tmer = tm.Groups[3].Value;
                if (tmer == "pm" && thour < 12) thour += 12;
                else if (tmer == "am" && thour == 12) thour = 0;

                if (thour <= 23 && tminute <= 59)
                {
                    // Check if it's the standard Sunday 9pm reset
                    bool isSunday = lower.Contains("sun");
                    bool isEastern = lower.Contains("et") || lower.Contains("eastern") || lower.Contains("new_york");
                    if (isSunday && (thour == 21 || (thour == 9 && tmer == "pm")))
                    {
                        return GetNextWeeklyResetTarget(now);
                    }

                    TimeZoneInfo sourceTz = isEastern ? ResolveTimeZone("America/New_York") : (thour == 1 && tminute == 0 ? TimeZoneInfo.Utc : TimeZoneInfo.Local);
                    var nowInSource = TimeZoneInfo.ConvertTime(now, TimeZoneInfo.Local, sourceTz);

                    DayOfWeek? targetDow = null;
                    foreach (var (abbr, dow) in Weekdays)
                    {
                        if (lower.Contains(abbr)) { targetDow = dow; break; }
                    }

                    DateTime candidateInSource;
                    if (targetDow.HasValue)
                    {
                        int delta = (((int)targetDow.Value) - (int)nowInSource.DayOfWeek + 7) % 7;
                        if (delta == 0 && (nowInSource.Hour > thour || (nowInSource.Hour == thour && nowInSource.Minute >= tminute)))
                        {
                            delta = 7;
                        }
                        candidateInSource = nowInSource.Date.AddDays(delta).Add(new TimeSpan(thour, tminute, 0));
                    }
                    else
                    {
                        candidateInSource = nowInSource.Date.Add(new TimeSpan(thour, tminute, 0));
                        if (candidateInSource <= nowInSource) candidateInSource = candidateInSource.AddDays(1);
                    }

                    var candidateUtc = TimeZoneInfo.ConvertTimeToUtc(candidateInSource, sourceTz);
                    return TimeZoneInfo.ConvertTimeFromUtc(candidateUtc, TimeZoneInfo.Local);
                }
            }

            return GetNextWeeklyResetTarget(now);
        }

        internal static TimeZoneInfo ResolveTimeZone(string tzName)
        {
            if (string.IsNullOrWhiteSpace(tzName)) return TimeZoneInfo.Local;

            // 1. Exact system match (Windows or IANA on .NET 6+)
            if (TimeZoneInfo.TryFindSystemTimeZoneById(tzName, out var tz)) return tz;

            string lower = tzName.ToLowerInvariant().Trim();

            // 2. UTC / GMT
            if (lower == "utc" || lower == "gmt" || lower == "z" || lower.Contains("universal") || lower.Contains("etc/utc") || lower.Contains("etc/gmt"))
            {
                return TimeZoneInfo.Utc;
            }

            // 3. Eastern (ET / EDT / EST / America/New_York / US/Eastern)
            if (lower.Contains("new_york") || lower.Contains("eastern") || lower.Contains("detroit") || lower.Contains("toronto") || lower == "et" || lower == "est" || lower == "edt" || lower.Contains("us/eastern"))
            {
                if (TimeZoneInfo.TryFindSystemTimeZoneById("Eastern Standard Time", out var est)) return est;
                if (TimeZoneInfo.TryFindSystemTimeZoneById("America/New_York", out var any)) return any;
            }

            // 4. Central (CT / CDT / CST / America/Chicago / US/Central)
            if (lower.Contains("chicago") || lower.Contains("central") || lower == "ct" || lower == "cst" || lower == "cdt" || lower.Contains("us/central"))
            {
                if (TimeZoneInfo.TryFindSystemTimeZoneById("Central Standard Time", out var cst)) return cst;
                if (TimeZoneInfo.TryFindSystemTimeZoneById("America/Chicago", out var ach)) return ach;
            }

            // 5. Mountain (MT / MDT / MST / America/Denver / US/Mountain)
            if (lower.Contains("denver") || lower.Contains("mountain") || lower == "mt" || lower == "mst" || lower == "mdt" || lower.Contains("us/mountain"))
            {
                if (TimeZoneInfo.TryFindSystemTimeZoneById("Mountain Standard Time", out var mst)) return mst;
                if (TimeZoneInfo.TryFindSystemTimeZoneById("America/Denver", out var ade)) return ade;
            }

            // 6. Pacific (PT / PDT / PST / America/Los_Angeles / US/Pacific)
            if (lower.Contains("los_angeles") || lower.Contains("pacific") || lower == "pt" || lower == "pst" || lower == "pdt" || lower.Contains("us/pacific"))
            {
                if (TimeZoneInfo.TryFindSystemTimeZoneById("Pacific Standard Time", out var pst)) return pst;
                if (TimeZoneInfo.TryFindSystemTimeZoneById("America/Los_Angeles", out var ala)) return ala;
            }

            return TimeZoneInfo.Local;
        }

        /// <summary>"1d 4h 12m" / "4h 12m" / "12m" — omits leading zero units.</summary>
        internal static string FormatCountdown(TimeSpan t)
        {
            if (t < TimeSpan.Zero) t = TimeSpan.Zero;
            int days = t.Days;
            int hours = t.Hours;
            int minutes = t.Minutes;
            var sb = new StringBuilder();
            if (days > 0) sb.Append($"{days}d ");
            if (days > 0 || hours > 0) sb.Append($"{hours}h ");
            sb.Append($"{minutes}m");
            return sb.ToString();
        }

        // ── status assembly ─────────────────────────────────────────────────

        private void Emit(ClaudeUsageMeterState state, string? reason = null)
        {
            _lastState = state;
            var status = new ClaudeUsageStatus
            {
                State = state,
                Percent = _percent,
                ResetTarget = _resetTarget,
                WeeklyPercent = _weeklyPercent,
                WeeklyResetTarget = _weeklyResetTarget,
                LastPoll = _lastPoll,
                DisplayText = BuildDisplayText(state),
                ToolTip = BuildToolTip(state, reason),
                WeeklyDisplayText = BuildWeeklyDisplayText(state),
                WeeklyToolTip = BuildWeeklyToolTip(state, reason),
            };
            StatusChanged?.Invoke(status);
        }

        private string BuildDisplayText(ClaudeUsageMeterState state)
        {
            if (!_percent.HasValue) return "Claude: --";

            string text = $"Claude: {_percent.Value}% used";
            if (_percent.Value >= CountdownThresholdPercent)
            {
                var target = _resetTarget ?? GetNextWeeklyResetTarget();
                var remaining = target - DateTime.Now;
                if (remaining > TimeSpan.Zero)
                    text += $" — resets in {FormatCountdown(remaining)}";
            }

            if (_projectedFullTarget.HasValue)
            {
                var toFull = _projectedFullTarget.Value - DateTime.Now;
                if (toFull > TimeSpan.Zero)
                    text += $" · ~{FormatCountdown(toFull)} to 100%";
            }

            return text;
        }

        private string BuildToolTip(ClaudeUsageMeterState state, string? reason)
        {
            var tip = new StringBuilder();
            tip.Append("Claude usage meter (Current Session)");
            tip.Append(state switch
            {
                ClaudeUsageMeterState.Polling => "\nChecking Claude usage via CLI (claude -p /usage)…",
                ClaudeUsageMeterState.Unavailable => $"\nUnavailable{(string.IsNullOrEmpty(reason) ? "" : $" ({reason})")} — is claude CLI logged in?",
                ClaudeUsageMeterState.Error => $"\nError{(string.IsNullOrEmpty(reason) ? "" : $": {reason}")}",
                _ => _percent.HasValue ? $"\n{_percent.Value}% of the Current Session window used" : "",
            });
            var target = _resetTarget ?? GetNextWeeklyResetTarget();
            tip.Append($"\nResets: {target:ddd MMM d, h:mm tt}");
            if (_projectedFullTarget.HasValue)
                tip.Append($"\nProjected 100%: {_projectedFullTarget.Value:ddd MMM d, h:mm tt} (~{_projectedRatePerHour:0.0}%/hr at the current rate)");
            tip.Append(_lastPoll.HasValue ? $"\nLast checked: {_lastPoll:HH:mm:ss}" : "\nLast checked: —");
            return tip.ToString();
        }

        private string BuildWeeklyDisplayText(ClaudeUsageMeterState state)
        {
            if (!_weeklyPercent.HasValue) return "Claude Weekly: --";

            string text = $"Claude Weekly: {_weeklyPercent.Value}% used";
            if (_weeklyPercent.Value >= CountdownThresholdPercent)
            {
                var target = _weeklyResetTarget ?? GetNextWeeklyResetTarget();
                var remaining = target - DateTime.Now;
                if (remaining > TimeSpan.Zero)
                    text += $" — resets in {FormatCountdown(remaining)}";
            }

            if (_weeklyProjectedFullTarget.HasValue)
            {
                var toFull = _weeklyProjectedFullTarget.Value - DateTime.Now;
                if (toFull > TimeSpan.Zero)
                    text += $" · ~{FormatCountdown(toFull)} to 100%";
            }

            return text;
        }

        private string BuildWeeklyToolTip(ClaudeUsageMeterState state, string? reason)
        {
            var tip = new StringBuilder();
            tip.Append("Claude usage meter (All Models tier)");
            tip.Append(state switch
            {
                ClaudeUsageMeterState.Polling => "\nChecking Claude usage via CLI (claude -p /usage)…",
                ClaudeUsageMeterState.Unavailable => $"\nUnavailable{(string.IsNullOrEmpty(reason) ? "" : $" ({reason})")} — is claude CLI logged in?",
                ClaudeUsageMeterState.Error => $"\nError{(string.IsNullOrEmpty(reason) ? "" : $": {reason}")}",
                _ => _weeklyPercent.HasValue ? $"\n{_weeklyPercent.Value}% of the All Models window used" : "",
            });
            var target = _weeklyResetTarget ?? GetNextWeeklyResetTarget();
            tip.Append($"\nResets: {target:ddd MMM d, h:mm tt}");
            if (_weeklyProjectedFullTarget.HasValue)
                tip.Append($"\nProjected 100%: {_weeklyProjectedFullTarget.Value:ddd MMM d, h:mm tt} (~{_weeklyProjectedRatePerHour:0.0}%/hr at the current rate)");
            tip.Append(_lastPoll.HasValue ? $"\nLast checked: {_lastPoll:HH:mm:ss}" : "\nLast checked: —");
            return tip.ToString();
        }

        // ── WebView2 fallback plumbing ──────────────────────────────────────

        private class PageUsageReading
        {
            public int? SessionPercent { get; set; }
            public string SessionValueText { get; set; } = string.Empty;
            public string SessionResetLabel { get; set; } = string.Empty;

            public int? WeeklyPercent { get; set; }
            public string WeeklyValueText { get; set; } = string.Empty;
            public string WeeklyResetLabel { get; set; } = string.Empty;
        }

        private class PageProbe
        {
            public string Url { get; set; } = string.Empty;
            public string ReadyState { get; set; } = string.Empty;
            public int MeterCount { get; set; }
            public bool HasPasswordField { get; set; }
            public bool HasLoginText { get; set; }
            public int BodyTextLength { get; set; }
            public string ResetLabel { get; set; } = string.Empty;
            public (string now, string max, string text, string label)[] Meters { get; set; } = Array.Empty<(string, string, string, string)>();
            public int WaitedMs { get; set; }

            public bool AuthWall => HasPasswordField || (HasLoginText && MeterCount == 0);
        }

        private async Task<PageProbe?> WaitForHydrationAsync()
        {
            int waited = 0;
            PageProbe? last = null;

            while (true)
            {
                var probe = await ProbePageAsync();
                if (probe != null)
                {
                    probe.WaitedMs = waited;
                    last = probe;

                    if (probe.MeterCount > 0)
                    {
                        if (PostMeterSettleMs > 0) await Task.Delay(PostMeterSettleMs);
                        return await ProbePageAsync() is { } settled
                            ? Also(settled, waited + PostMeterSettleMs)
                            : probe;
                    }
                    if (probe.AuthWall)
                        return probe;
                }

                if (waited >= HydrationMaxWaitMs)
                    return last;

                await Task.Delay(HydrationPollIntervalMs);
                waited += HydrationPollIntervalMs;
            }
        }

        private static PageProbe Also(PageProbe p, int waitedMs) { p.WaitedMs = waitedMs; return p; }

        private async Task<PageProbe?> ProbePageAsync()
        {
            if (_webView?.CoreWebView2 == null) return null;

            const string script = @"
(function() {
    try {
        var meters = [];
        var els = document.querySelectorAll('[role=""meter""], [role=""progressbar""], div[class*=""progress""]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var container = el.closest('div, section, li') || el;
            var heading = (container.innerText || container.textContent || '').trim();
            meters.push({
                valuenow: el.getAttribute('aria-valuenow') || '',
                valuemax: el.getAttribute('aria-valuemax') || '',
                valuetext: el.getAttribute('aria-valuetext') || '',
                label: heading.substring(0, 100)
            });
        }
        var resetLabel = '';
        var nodes = document.querySelectorAll('p, span, div, time, li');
        for (var j = 0; j < nodes.length; j++) {
            var txt = (nodes[j].innerText || nodes[j].textContent || '').trim();
            if (txt && txt.length < 120 && /reset/i.test(txt)) { resetLabel = txt; break; }
        }
        var bodyText = (document.body && (document.body.innerText || document.body.textContent) || '');
        var hasPassword = !!document.querySelector('input[type=password]');
        var hasLoginText = /log in to claude|sign in|continue with google|welcome back/i.test(bodyText);
        return JSON.stringify({
            url: location.href,
            readyState: document.readyState,
            meters: meters,
            resetLabel: resetLabel,
            hasPassword: hasPassword,
            hasLoginText: hasLoginText,
            bodyLen: bodyText.length
        });
    } catch (ex) {
        return JSON.stringify({ meters: [], resetLabel: '', error: ex.message });
    }
})();";

            var root = await EvalAsync(script);
            if (root == null) return null;

            var probe = new PageProbe
            {
                Url = GetStr(root.Value, "url"),
                ReadyState = GetStr(root.Value, "readyState"),
                ResetLabel = GetStr(root.Value, "resetLabel"),
                HasPasswordField = GetBool(root.Value, "hasPassword"),
                HasLoginText = GetBool(root.Value, "hasLoginText"),
                BodyTextLength = GetInt(root.Value, "bodyLen"),
            };

            if (root.Value.TryGetProperty("meters", out var meters) && meters.ValueKind == JsonValueKind.Array)
            {
                var list = new List<(string, string, string, string)>();
                foreach (var m in meters.EnumerateArray())
                {
                    list.Add((
                        m.TryGetProperty("valuenow", out var vn) ? (vn.GetString() ?? string.Empty) : string.Empty,
                        m.TryGetProperty("valuemax", out var vm) ? (vm.GetString() ?? string.Empty) : string.Empty,
                        m.TryGetProperty("valuetext", out var vt) ? (vt.GetString() ?? string.Empty) : string.Empty,
                        m.TryGetProperty("label", out var vl) ? (vl.GetString() ?? string.Empty) : string.Empty));
                }
                probe.Meters = list.ToArray();
                probe.MeterCount = list.Count;
            }

            return probe;
        }

        private static PageUsageReading ExtractReading(PageProbe probe)
        {
            int? sessionPercent = null;
            string sessionValueText = string.Empty;
            string sessionResetLabel = string.Empty;

            int? weeklyPercent = null;
            string weeklyValueText = string.Empty;
            string weeklyResetLabel = string.Empty;

            // 1. First attempt exact match on label
            foreach (var (now, max, text, label) in probe.Meters)
            {
                int? pct = ComputePercent(now, max, text);
                if (pct == null) continue;

                if (Regex.IsMatch(label, @"current\s+session", RegexOptions.IgnoreCase))
                {
                    sessionPercent = pct;
                    sessionValueText = text;
                    sessionResetLabel = probe.ResetLabel;
                }
                else if (Regex.IsMatch(label, @"all\s+models?", RegexOptions.IgnoreCase))
                {
                    weeklyPercent = pct;
                    weeklyValueText = text;
                    weeklyResetLabel = probe.ResetLabel;
                }
            }

            // 2. Fallbacks
            if (sessionPercent == null || weeklyPercent == null)
            {
                int idx = 0;
                foreach (var (now, max, text, label) in probe.Meters)
                {
                    int? pct = ComputePercent(now, max, text);
                    if (pct == null) continue;

                    if (idx == 0 && sessionPercent == null)
                    {
                        sessionPercent = pct;
                        sessionValueText = text;
                        sessionResetLabel = probe.ResetLabel;
                    }
                    else if (weeklyPercent == null)
                    {
                        weeklyPercent = pct;
                        weeklyValueText = text;
                        weeklyResetLabel = probe.ResetLabel;
                    }
                    idx++;
                }
            }

            return new PageUsageReading
            {
                SessionPercent = sessionPercent,
                SessionValueText = sessionValueText,
                SessionResetLabel = sessionResetLabel,
                WeeklyPercent = weeklyPercent,
                WeeklyValueText = weeklyValueText,
                WeeklyResetLabel = weeklyResetLabel
            };
        }

        private static string DescribeMeters(PageProbe probe)
        {
            var sb = new StringBuilder();
            for (int i = 0; i < probe.Meters.Length; i++)
            {
                var (now, max, text, label) = probe.Meters[i];
                if (i > 0) sb.Append("; ");
                sb.Append($"[{i}] valuenow=\"{now}\" valuemax=\"{max}\" valuetext=\"{Trim(text)}\" label=\"{Trim(label)}\"");
            }
            return sb.Length == 0 ? "(none)" : sb.ToString();
        }

        private static string GetStr(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? string.Empty) : string.Empty;
        private static bool GetBool(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) && v.GetBoolean();
        private static int GetInt(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : 0;

        internal static int? ComputePercent(string valuenow, string valuemax, string valuetext)
        {
            var pctMatch = Regex.Match(valuetext ?? string.Empty, @"(\d+(?:\.\d+)?)\s*%");
            if (pctMatch.Success && double.TryParse(pctMatch.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var pv))
                return Clamp(pv);

            if (!double.TryParse(valuenow, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var now))
                return null;

            double max = 100;
            if (double.TryParse(valuemax, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var m) && m > 0)
                max = m;

            double percent = (Math.Abs(max - 100) > 0.001) ? (now / max * 100.0) : now;
            return Clamp(percent);
        }

        private static int Clamp(double p) => (int)Math.Round(Math.Max(0, Math.Min(100, p)));

        private async Task<bool> NavigateAsync(string url)
        {
            if (_webView?.CoreWebView2 == null) return false;

            // Navigating to the same hash-route on the same page does not fire NavigationCompleted in WebView2.
            // By navigating to about:blank first, we guarantee a transition that triggers NavigationCompleted,
            // resetting the document state and ensuring the subsequent navigate to claude.ai fully reloads.
            var tcsBlank = new TaskCompletionSource<bool>();
            void NavHandlerBlank(object? sender, CoreWebView2NavigationCompletedEventArgs args)
            {
                _webView.NavigationCompleted -= NavHandlerBlank;
                tcsBlank.TrySetResult(args.IsSuccess);
            }

            _webView.NavigationCompleted += NavHandlerBlank;
            try
            {
                _webView.CoreWebView2.Navigate("about:blank");
            }
            catch (Exception ex)
            {
                _webView.NavigationCompleted -= NavHandlerBlank;
                ActivityLog.Log(Channel, $"Navigate(about:blank) threw: {ex.Message}");
                return false;
            }

            var completedBlank = await Task.WhenAny(tcsBlank.Task, Task.Delay(5000));
            if (completedBlank != tcsBlank.Task || !await tcsBlank.Task)
            {
                _webView.NavigationCompleted -= NavHandlerBlank;
                ActivityLog.Log(Channel, "Navigate(about:blank) failed or timed out.");
                return false;
            }

            var tcs = new TaskCompletionSource<bool>();
            void NavHandler(object? sender, CoreWebView2NavigationCompletedEventArgs args)
            {
                _webView.NavigationCompleted -= NavHandler;
                tcs.TrySetResult(args.IsSuccess);
            }

            _webView.NavigationCompleted += NavHandler;
            try
            {
                _webView.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                _webView.NavigationCompleted -= NavHandler;
                ActivityLog.Log(Channel, $"Navigate({url}) threw: {ex.Message}");
                return false;
            }

            var completed = await Task.WhenAny(tcs.Task, Task.Delay(NavigationTimeoutMs));
            if (completed != tcs.Task)
            {
                _webView.NavigationCompleted -= NavHandler;
                ActivityLog.Log(Channel, $"Navigate({url}) timed out after {NavigationTimeoutMs}ms.");
                return false;
            }

            return await tcs.Task;
        }

        private async Task<JsonElement?> EvalAsync(string script)
        {
            if (_webView?.CoreWebView2 == null) return null;
            try
            {
                string resJson = await _webView.ExecuteScriptAsync(script) ?? string.Empty;
                using var outerDoc = JsonDocument.Parse(resJson);
                string inner = outerDoc.RootElement.GetString() ?? "{}";
                using var innerDoc = JsonDocument.Parse(inner);
                return innerDoc.RootElement.Clone();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Script evaluation failed: {ex.Message}");
                return null;
            }
        }

        private static string Trim(string? s) =>
            string.IsNullOrEmpty(s) ? "" : (s!.Length > 80 ? s.Substring(0, 80) + "…" : s);
    }
}

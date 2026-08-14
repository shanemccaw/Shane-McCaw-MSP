using System;
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
        /// <summary>Actively navigating claude.ai/settings/usage and reading the meter right now.</summary>
        Polling,
        /// <summary>Page loaded but no meter could be read (not logged in, or the page structure changed) — show a muted "Claude: --" rather than a stale/guessed number.</summary>
        Unavailable,
        /// <summary>Navigation itself failed / the check threw.</summary>
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
        public DateTime? LastPoll { get; set; }
    }

    /// <summary>
    /// Background watcher that keeps a live Claude usage percentage in the status bar.
    ///
    /// Same in-process spirit as <see cref="ReplitWatcherService"/> (#902): a
    /// DispatcherTimer drives a periodic check through a dedicated HIDDEN
    /// WebView2 hosted in MainWindow, initialised through the SAME shared
    /// WebView2 environment (MainWindow.EnsureWebViewInitializedAsync) as every
    /// visible tab so it shares Shane's authenticated claude.ai cookies/session
    /// — required, because /settings/usage only renders the meter when logged
    /// in. A separate, dedicated hidden WebView2 (not the Replit one) so the two
    /// watchers never fight over the same control's navigation.
    ///
    /// Extraction is content-based: it navigates to claude.ai/settings/usage and
    /// reads the real aria-valuenow / aria-valuetext off the [role="meter"]
    /// element plus the nearby "Resets …" label, via the same querySelector
    /// JS-injection + double-JSON-unwrap pattern UiTestExecutor (#832/#864) and
    /// the Replit watcher use.
    ///
    /// If anything fails (not logged in, page changed, element not found, nav
    /// failure), it publishes a muted "Claude: --" — never a stale or wrong
    /// number, and never a crash.
    ///
    /// The reset "Resets Sun 9:00 PM" label is parsed into a real next-occurrence
    /// LOCAL datetime, and (only when usage ≥ 85%) a "resets in Xd Xh Xm"
    /// countdown is appended. That countdown is ticked SMOOTHLY by a second,
    /// fast display timer off the already-known reset target — only the
    /// underlying percentage itself needs the real (slow) poll to refresh.
    ///
    /// Logging channel: "usage-meter" via ActivityLog.Log — every poll attempt,
    /// success, and failure.
    /// </summary>
    public class ClaudeUsageMeterService
    {
        public const string Channel = "usage-meter";

        // Confirmed real URL: Shane navigated to this himself in his own browser and
        // confirmed it lands on the usage page. The SPA routes usage off the /new
        // shell with a #settings/usage hash fragment; the older bare
        // https://claude.ai/settings/usage no longer renders the meter reliably.
        public const string UsageUrl = "https://claude.ai/new#settings/usage";

        /// <summary>Reasonable, deliberately-not-real-time poll cadence (the task asks for 5–15 min).</summary>
        private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(10);

        /// <summary>How often the visible countdown re-renders between polls. Only the text ticks; the percentage is untouched until the next real poll.</summary>
        private static readonly TimeSpan DisplayTickInterval = TimeSpan.FromSeconds(30);

        /// <summary>At/above this usage the countdown is shown alongside the percentage; below it, just the plain percentage.</summary>
        private const int CountdownThresholdPercent = 85;

        private const int NavigationTimeoutMs = 20000;

        // The usage page is a client-side-rendered SPA: NavigationCompleted fires when
        // the HTML shell lands, long before React has hydrated and painted the
        // [role="meter"] element. Rather than a single fixed short delay (which raced
        // hydration and produced spurious "meter not found"), poll the DOM until the
        // meter actually appears, an auth wall is detected, or we give up.
        private const int HydrationMaxWaitMs = 12000;
        private const int HydrationPollIntervalMs = 400;
        // A minimum settle even once a meter appears, so a half-hydrated meter (element
        // present, aria values not yet populated) gets a moment to finish.
        private const int PostMeterSettleMs = 400;

        private readonly WebView2 _webView;
        private readonly Func<WebView2, Task<bool>> _ensureInitialized;
        private readonly DispatcherTimer _pollTimer;
        private readonly DispatcherTimer _displayTimer;

        private bool _busy;
        private int? _percent;
        private DateTime? _resetTarget;
        private DateTime? _lastPoll;
        private ClaudeUsageMeterState _lastState = ClaudeUsageMeterState.Unavailable;

        // ── projected "time until 100%" (real observed growth rate, current window only) ──
        // Anchored exactly like _resetTarget: an absolute LOCAL datetime the estimate points AT,
        // so the between-poll display timer can tick it down live against DateTime.Now the same
        // way the reset countdown does, without recomputing the rate. Null until there's enough
        // data in the current reset window to make a meaningful projection.
        private DateTime? _projectedFullTarget;
        private double _projectedRatePerHour;

        public event Action<ClaudeUsageStatus>? StatusChanged;

        public ClaudeUsageMeterService(WebView2 webView, Func<WebView2, Task<bool>> ensureInitialized)
        {
            _webView = webView;
            _ensureInitialized = ensureInitialized;

            _pollTimer = new DispatcherTimer { Interval = PollInterval };
            _pollTimer.Tick += async (_, _) => await TickAsync();

            _displayTimer = new DispatcherTimer(DispatcherPriority.Background) { Interval = DisplayTickInterval };
            _displayTimer.Tick += (_, _) => OnDisplayTick();
        }

        /// <summary>Starts the poll + display timers and fires the first poll immediately (so the bar isn't blank for a whole interval). Safe to call once at startup.</summary>
        public void Start()
        {
            _pollTimer.Start();
            _displayTimer.Start();
            Emit(ClaudeUsageMeterState.Polling); // shows "Claude: --" until the first read lands
            ActivityLog.Log(Channel, $"Started — polling {UsageUrl} every {PollInterval.TotalMinutes:0} min; countdown shown at ≥{CountdownThresholdPercent}%.");
            _ = TickAsync();
        }

        public void Stop()
        {
            _pollTimer.Stop();
            _displayTimer.Stop();
        }

        /// <summary>One real poll: navigate the hidden WebView2 to the usage page, read the meter + reset label, update cached state, and publish. Never lets ticks stack, never throws out.</summary>
        private async Task TickAsync()
        {
            if (_busy) return;
            _busy = true;
            try
            {
                if (!await _ensureInitialized(_webView) || _webView.CoreWebView2 == null)
                {
                    ActivityLog.Log(Channel, "Poll skipped — background WebView2 failed to initialise.");
                    SetUnavailable("WebView2 not ready");
                    return;
                }

                Emit(ClaudeUsageMeterState.Polling);
                ActivityLog.Log(Channel, $"Polling {UsageUrl} …");

                // ── Phase 1: navigation itself ──────────────────────────────
                if (!await NavigateAsync(UsageUrl))
                {
                    // NavigateAsync already logged the specific reason (threw / timed out).
                    ActivityLog.Log(Channel, "FAIL[navigation] — the usage page never reported a successful NavigationCompleted; nothing could be read. Showing muted state.");
                    SetUnavailable("usage page did not load");
                    return;
                }
                ActivityLog.Log(Channel, "OK[navigation] — page shell loaded; waiting for the SPA to hydrate the meter …");

                // ── Phase 2: wait for the SPA to actually render the meter ───
                var probe = await WaitForHydrationAsync();
                _lastPoll = DateTime.Now;

                if (probe == null)
                {
                    // Could not even run the DOM probe (script eval failed) — genuinely opaque.
                    ActivityLog.Log(Channel, "FAIL[probe] — navigation succeeded but the in-page diagnostic script could not be evaluated at all. Showing muted state.");
                    SetUnavailable("page not readable");
                    return;
                }

                // ── Phase 3: classify what we actually landed on ────────────
                // 3a — an auth / login wall instead of the real usage page.
                if (probe.AuthWall)
                {
                    ActivityLog.Log(Channel,
                        $"FAIL[auth-wall] — navigation succeeded but the page looks like a login/auth wall, not the usage page. url=\"{Trim(probe.Url)}\", readyState={probe.ReadyState}, meters={probe.MeterCount}, passwordField={probe.HasPasswordField}, loginText={probe.HasLoginText}, bodyLen={probe.BodyTextLength}. Sign in to claude.ai in a normal BuildConsole tab so the shared cookies authenticate this hidden poll. Showing muted state.");
                    SetUnavailable("hit a login/auth wall — sign in to claude.ai");
                    return;
                }

                // 3b — page loaded, not an auth wall, but the meter never appeared.
                if (probe.MeterCount == 0)
                {
                    ActivityLog.Log(Channel,
                        $"FAIL[meter-not-found] — navigation succeeded and no auth wall, but [role=\"meter\"] never appeared after {HydrationMaxWaitMs}ms of hydration polling (SPA slow, page structure changed, or usage not shown for this account). url=\"{Trim(probe.Url)}\", readyState={probe.ReadyState}, bodyLen={probe.BodyTextLength}, resetLabelSeen={(string.IsNullOrEmpty(probe.ResetLabel) ? "no" : "yes")}. Showing muted state.");
                    SetUnavailable("meter not found on usage page");
                    return;
                }

                // 3c — meter element(s) present, but none yielded a usable percentage
                //      (aria-valuenow / aria-valuetext missing or malformed).
                var reading = ExtractReading(probe);
                if (reading.Percent == null)
                {
                    ActivityLog.Log(Channel,
                        $"FAIL[meter-malformed] — found {probe.MeterCount} [role=\"meter\"] element(s) but none had a parseable value; aria-valuenow/aria-valuetext missing or malformed. Raw meters: {DescribeMeters(probe)}. url=\"{Trim(probe.Url)}\". Showing muted state.");
                    SetUnavailable("meter present but value unreadable");
                    return;
                }

                // 3d — success.
                _percent = reading.Percent;
                _resetTarget = ParseResetTarget(reading.ResetLabel);

                ActivityLog.Log(Channel,
                    $"OK[read] — {_percent}% used (from {probe.MeterCount} meter(s); winning valuetext=\"{Trim(reading.ValueText)}\"); reset label=\"{Trim(reading.ResetLabel)}\" → target {(_resetTarget.HasValue ? _resetTarget.Value.ToString("ddd yyyy-MM-dd HH:mm") : "unparsed")}. hydration≈{probe.WaitedMs}ms.");

                // Persist this data point and (re)compute the time-until-100% projection off the
                // real observed growth rate within the current reset window.
                UpdateProjection(_percent.Value, _resetTarget, _lastPoll ?? DateTime.Now);

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

        /// <summary>Fast between-poll tick: only re-emits when a live countdown is actually being shown (usage ≥ threshold with a known reset target), so the seconds/minutes visibly tick down without a real poll. Otherwise it's a no-op — the plain percentage doesn't change between polls.</summary>
        private void OnDisplayTick()
        {
            if (_lastState != ClaudeUsageMeterState.Ok) return;

            // Re-emit when EITHER live countdown is showing so its text visibly ticks between
            // polls: the reset countdown (usage ≥ threshold with a known reset target), or the
            // projected time-to-100% (which is shown at any usage level once there's a projection).
            bool resetCountdownShown = _percent.HasValue && _percent.Value >= CountdownThresholdPercent && _resetTarget.HasValue;
            bool projectionShown = _projectedFullTarget.HasValue;
            if (resetCountdownShown || projectionShown)
                Emit(ClaudeUsageMeterState.Ok);
        }

        private void SetUnavailable(string reason, ClaudeUsageMeterState state = ClaudeUsageMeterState.Unavailable)
        {
            // Drop the stale number so we never show a wrong percentage — and with it the
            // projection, which is only meaningful next to a live reading.
            _percent = null;
            _resetTarget = null;
            _projectedFullTarget = null;
            _projectedRatePerHour = 0;
            Emit(state, reason);
        }

        // ── time-until-100% projection ──────────────────────────────────────

        /// <summary>Persists the just-read (timestamp, percentage) point, then recomputes the
        /// time-until-100% projection from the real growth rate observed WITHIN the current reset
        /// window (see <see cref="UsageProjection"/>). Anchors the estimate as an absolute target
        /// datetime so the display timer can tick it down live, exactly like the reset countdown.
        /// Logs both the stored point and the resulting projection (or the reason one was withheld)
        /// for diagnosability. Never throws out — a store/compute hiccup just means no projection
        /// this cycle, not a failed poll.</summary>
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

        // ── meter extraction ────────────────────────────────────────────────

        private class MeterReading
        {
            public int? Percent { get; set; }
            public string ValueText { get; set; } = string.Empty;
            public string ResetLabel { get; set; } = string.Empty;
        }

        /// <summary>One in-page snapshot: the raw meter attributes plus enough page-level
        /// signal to tell an auth wall from a slow SPA from a genuinely-missing meter. All
        /// interpretation happens in C# so the diagnostics stay in the log, not the page.</summary>
        private class PageProbe
        {
            public string Url { get; set; } = string.Empty;
            public string ReadyState { get; set; } = string.Empty;
            public int MeterCount { get; set; }
            public bool HasPasswordField { get; set; }
            public bool HasLoginText { get; set; }
            public int BodyTextLength { get; set; }
            public string ResetLabel { get; set; } = string.Empty;
            public (string now, string max, string text)[] Meters { get; set; } = Array.Empty<(string, string, string)>();
            public int WaitedMs { get; set; }

            /// <summary>Login/auth wall heuristic: an explicit password field, or login-ish copy
            /// with no meter present at all. Kept deliberately conservative so a real usage page
            /// (which has a meter) is never misclassified as an auth wall.</summary>
            public bool AuthWall => HasPasswordField || (HasLoginText && MeterCount == 0);
        }

        /// <summary>Polls the DOM until the meter renders, an auth wall is detected, or
        /// <see cref="HydrationMaxWaitMs"/> elapses. Returns the last probe taken (or the first
        /// definitive one). Null only if the probe script could never be evaluated.</summary>
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

                    // Definitive outcomes — stop polling early:
                    //  • a meter appeared (page is up), or
                    //  • an auth wall is clearly showing (no point waiting for a meter that won't come).
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
                    return last; // give up: return whatever the last probe saw (for the diagnostics)

                await Task.Delay(HydrationPollIntervalMs);
                waited += HydrationPollIntervalMs;
            }
        }

        private static PageProbe Also(PageProbe p, int waitedMs) { p.WaitedMs = waitedMs; return p; }

        /// <summary>Single DOM snapshot: reads every [role="meter"] (aria-valuenow/valuemax/valuetext),
        /// the first "Resets …" label, and page-level auth/readiness signals. Pure read.</summary>
        private async Task<PageProbe?> ProbePageAsync()
        {
            const string script = @"
(function() {
    try {
        var meters = [];
        var els = document.querySelectorAll('[role=""meter""]');
        for (var i = 0; i < els.length; i++) {
            meters.push({
                valuenow: els[i].getAttribute('aria-valuenow'),
                valuemax: els[i].getAttribute('aria-valuemax'),
                valuetext: els[i].getAttribute('aria-valuetext')
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
                var list = new System.Collections.Generic.List<(string, string, string)>();
                foreach (var m in meters.EnumerateArray())
                {
                    list.Add((
                        m.TryGetProperty("valuenow", out var vn) ? (vn.GetString() ?? string.Empty) : string.Empty,
                        m.TryGetProperty("valuemax", out var vm) ? (vm.GetString() ?? string.Empty) : string.Empty,
                        m.TryGetProperty("valuetext", out var vt) ? (vt.GetString() ?? string.Empty) : string.Empty));
                }
                probe.Meters = list.ToArray();
                probe.MeterCount = list.Count;
            }

            return probe;
        }

        /// <summary>Picks the most-constraining meter (highest %) out of a probe. All parsing in C#.</summary>
        private static MeterReading ExtractReading(PageProbe probe)
        {
            int? best = null;
            string bestText = string.Empty;
            foreach (var (now, max, text) in probe.Meters)
            {
                int? pct = ComputePercent(now, max, text);
                if (pct == null) continue;
                if (best == null || pct.Value > best.Value)
                {
                    best = pct;
                    bestText = text;
                }
            }
            return new MeterReading { Percent = best, ValueText = bestText, ResetLabel = probe.ResetLabel };
        }

        /// <summary>Compact human-readable dump of every raw meter's ARIA attributes, for the
        /// meter-malformed diagnostic log line.</summary>
        private static string DescribeMeters(PageProbe probe)
        {
            var sb = new StringBuilder();
            for (int i = 0; i < probe.Meters.Length; i++)
            {
                var (now, max, text) = probe.Meters[i];
                if (i > 0) sb.Append("; ");
                sb.Append($"[{i}] valuenow=\"{now}\" valuemax=\"{max}\" valuetext=\"{Trim(text)}\"");
            }
            return sb.Length == 0 ? "(none)" : sb.ToString();
        }

        private static string GetStr(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? (v.GetString() ?? string.Empty) : string.Empty;
        private static bool GetBool(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False) && v.GetBoolean();
        private static int GetInt(JsonElement e, string name) =>
            e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : 0;

        /// <summary>Turns a meter's raw ARIA attributes into a whole-number percentage. Prefers an explicit "NN%" in aria-valuetext; otherwise derives it from valuenow/valuemax (defaulting max to 100).</summary>
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

            // If max is a sensible non-100 scale, treat now as a fraction of it; otherwise now is already a percentage.
            double percent = (Math.Abs(max - 100) > 0.001) ? (now / max * 100.0) : now;
            return Clamp(percent);
        }

        private static int Clamp(double p) => (int)Math.Round(Math.Max(0, Math.Min(100, p)));

        // ── reset-label parsing ─────────────────────────────────────────────

        private static readonly (string abbr, DayOfWeek dow)[] Weekdays =
        {
            ("sun", DayOfWeek.Sunday), ("mon", DayOfWeek.Monday), ("tue", DayOfWeek.Tuesday),
            ("wed", DayOfWeek.Wednesday), ("thu", DayOfWeek.Thursday), ("fri", DayOfWeek.Friday),
            ("sat", DayOfWeek.Saturday),
        };

        /// <summary>
        /// Parses a "Resets Sun 9:00 PM" style label into the real next-occurrence LOCAL datetime.
        /// Handles a weekday+time (rolls to next week if this week's slot is already past), or a
        /// bare time (rolls to tomorrow if today's slot is past). Returns null if nothing parses —
        /// callers then simply omit the countdown.
        /// </summary>
        internal static DateTime? ParseResetTarget(string? label, DateTime? nowOverride = null)
        {
            if (string.IsNullOrWhiteSpace(label)) return null;
            var now = nowOverride ?? DateTime.Now;
            string lower = label.ToLowerInvariant();

            // time-of-day: "9:00 pm" (12h with meridiem) or "21:00"/"9:00" (24h / bare)
            var tm = Regex.Match(lower, @"(\d{1,2}):(\d{2})\s*(am|pm)?");
            if (!tm.Success) return null;

            int hour = int.Parse(tm.Groups[1].Value);
            int minute = int.Parse(tm.Groups[2].Value);
            if (minute > 59) return null;
            string mer = tm.Groups[3].Value;
            if (mer == "pm" && hour < 12) hour += 12;
            else if (mer == "am" && hour == 12) hour = 0;
            if (hour > 23) return null;

            var timeOfDay = new TimeSpan(hour, minute, 0);

            // weekday, if present
            DayOfWeek? targetDow = null;
            foreach (var (abbr, dow) in Weekdays)
            {
                if (lower.Contains(abbr)) { targetDow = dow; break; }
            }

            if (targetDow.HasValue)
            {
                int delta = (((int)targetDow.Value) - (int)now.DayOfWeek + 7) % 7;
                var candidate = now.Date.AddDays(delta).Add(timeOfDay);
                if (candidate <= now) candidate = candidate.AddDays(7);
                return candidate;
            }
            else
            {
                var candidate = now.Date.Add(timeOfDay);
                if (candidate <= now) candidate = candidate.AddDays(1);
                return candidate;
            }
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
                LastPoll = _lastPoll,
                DisplayText = BuildDisplayText(state),
                ToolTip = BuildToolTip(state, reason),
            };
            StatusChanged?.Invoke(status);
        }

        private string BuildDisplayText(ClaudeUsageMeterState state)
        {
            if (!_percent.HasValue) return "Claude: --";

            string text = $"Claude: {_percent.Value}% used";
            if (_percent.Value >= CountdownThresholdPercent && _resetTarget.HasValue)
            {
                var remaining = _resetTarget.Value - DateTime.Now;
                if (remaining > TimeSpan.Zero)
                    text += $" — resets in {FormatCountdown(remaining)}";
            }
            // Projected time-until-100% at the observed rate, shown alongside the percentage
            // once there's enough current-window data (the "~" flags it as an estimate).
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
            tip.Append("Claude usage meter");
            tip.Append(state switch
            {
                ClaudeUsageMeterState.Polling => "\nChecking claude.ai/settings/usage…",
                ClaudeUsageMeterState.Unavailable => $"\nUnavailable{(string.IsNullOrEmpty(reason) ? "" : $" ({reason})")} — is claude.ai logged in?",
                ClaudeUsageMeterState.Error => $"\nError{(string.IsNullOrEmpty(reason) ? "" : $": {reason}")}",
                _ => _percent.HasValue ? $"\n{_percent.Value}% of the current window used" : "",
            });
            if (_resetTarget.HasValue)
                tip.Append($"\nResets: {_resetTarget.Value:ddd MMM d, h:mm tt}");
            if (_projectedFullTarget.HasValue)
                tip.Append($"\nProjected 100%: {_projectedFullTarget.Value:ddd MMM d, h:mm tt} (~{_projectedRatePerHour:0.0}%/hr at the current rate)");
            tip.Append(_lastPoll.HasValue ? $"\nLast checked: {_lastPoll:HH:mm:ss}" : "\nLast checked: —");
            return tip.ToString();
        }

        // ── WebView2 plumbing (mirrors ReplitWatcherService) ────────────────

        /// <summary>Git #832 — must use CoreWebView2.Navigate(url), never set .Source (WPF skips the property-changed callback when the URL is unchanged, so a repeat poll to the same URL would deadlock waiting for a NavigationCompleted that never fires).</summary>
        private async Task<bool> NavigateAsync(string url)
        {
            if (_webView.CoreWebView2 == null) return false;

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

        /// <summary>Runs a JS snippet whose own return value is a JSON.stringify string, and unwraps the double JSON encoding ExecuteScriptAsync applies — identical handling to UiTestExecutor / ReplitWatcherService.</summary>
        private async Task<JsonElement?> EvalAsync(string script)
        {
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

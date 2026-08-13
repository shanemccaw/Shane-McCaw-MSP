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

        public const string UsageUrl = "https://claude.ai/settings/usage";

        /// <summary>Reasonable, deliberately-not-real-time poll cadence (the task asks for 5–15 min).</summary>
        private static readonly TimeSpan PollInterval = TimeSpan.FromMinutes(10);

        /// <summary>How often the visible countdown re-renders between polls. Only the text ticks; the percentage is untouched until the next real poll.</summary>
        private static readonly TimeSpan DisplayTickInterval = TimeSpan.FromSeconds(30);

        /// <summary>At/above this usage the countdown is shown alongside the percentage; below it, just the plain percentage.</summary>
        private const int CountdownThresholdPercent = 85;

        private const int NavigationTimeoutMs = 20000;
        private const int PostNavigationSettleMs = 1500;

        private readonly WebView2 _webView;
        private readonly Func<WebView2, Task<bool>> _ensureInitialized;
        private readonly DispatcherTimer _pollTimer;
        private readonly DispatcherTimer _displayTimer;

        private bool _busy;
        private int? _percent;
        private DateTime? _resetTarget;
        private DateTime? _lastPoll;
        private ClaudeUsageMeterState _lastState = ClaudeUsageMeterState.Unavailable;

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

                if (!await NavigateAsync(UsageUrl))
                {
                    ActivityLog.Log(Channel, "Poll: navigation to usage page failed — showing muted state.");
                    SetUnavailable("usage page did not load");
                    return;
                }

                await Task.Delay(PostNavigationSettleMs);

                var reading = await ReadMeterAsync();
                _lastPoll = DateTime.Now;

                if (reading == null || reading.Percent == null)
                {
                    ActivityLog.Log(Channel, "Poll: no [role=meter] found (not logged in, or page structure changed) — showing muted state.");
                    SetUnavailable("meter not found");
                    return;
                }

                _percent = reading.Percent;
                _resetTarget = ParseResetTarget(reading.ResetLabel);

                ActivityLog.Log(Channel,
                    $"Poll OK — {_percent}% used (valuetext=\"{Trim(reading.ValueText)}\"); reset label=\"{Trim(reading.ResetLabel)}\" → target {(_resetTarget.HasValue ? _resetTarget.Value.ToString("ddd yyyy-MM-dd HH:mm") : "unparsed")}.");

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
            if (_lastState == ClaudeUsageMeterState.Ok
                && _percent.HasValue && _percent.Value >= CountdownThresholdPercent
                && _resetTarget.HasValue)
            {
                Emit(ClaudeUsageMeterState.Ok);
            }
        }

        private void SetUnavailable(string reason, ClaudeUsageMeterState state = ClaudeUsageMeterState.Unavailable)
        {
            // Drop the stale number so we never show a wrong percentage.
            _percent = null;
            _resetTarget = null;
            Emit(state, reason);
        }

        // ── meter extraction ────────────────────────────────────────────────

        private class MeterReading
        {
            public int? Percent { get; set; }
            public string ValueText { get; set; } = string.Empty;
            public string ResetLabel { get; set; } = string.Empty;
        }

        /// <summary>Reads every [role="meter"] on the page (aria-valuenow/valuemax/valuetext) plus the first "Resets …" label, then picks the most-constraining meter (highest %). Pure read; all parsing is done in C#.</summary>
        private async Task<MeterReading?> ReadMeterAsync()
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
        return JSON.stringify({ meters: meters, resetLabel: resetLabel });
    } catch (ex) {
        return JSON.stringify({ meters: [], resetLabel: '', error: ex.message });
    }
})();";

            var root = await EvalAsync(script);
            if (root == null) return null;

            string resetLabel = root.Value.TryGetProperty("resetLabel", out var rl) ? (rl.GetString() ?? string.Empty) : string.Empty;

            if (!root.Value.TryGetProperty("meters", out var meters) || meters.ValueKind != JsonValueKind.Array || meters.GetArrayLength() == 0)
                return new MeterReading { Percent = null, ResetLabel = resetLabel };

            int? best = null;
            string bestText = string.Empty;
            foreach (var m in meters.EnumerateArray())
            {
                string valuenow = m.TryGetProperty("valuenow", out var vn) ? (vn.GetString() ?? string.Empty) : string.Empty;
                string valuemax = m.TryGetProperty("valuemax", out var vm) ? (vm.GetString() ?? string.Empty) : string.Empty;
                string valuetext = m.TryGetProperty("valuetext", out var vt) ? (vt.GetString() ?? string.Empty) : string.Empty;

                int? pct = ComputePercent(valuenow, valuemax, valuetext);
                if (pct == null) continue;
                if (best == null || pct.Value > best.Value)
                {
                    best = pct;
                    bestText = valuetext;
                }
            }

            return new MeterReading { Percent = best, ValueText = bestText, ResetLabel = resetLabel };
        }

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

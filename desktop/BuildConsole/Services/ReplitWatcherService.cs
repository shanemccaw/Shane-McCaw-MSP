using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    public enum ReplitWatcherState
    {
        /// <summary>Watcher toggled off in Settings.</summary>
        Disabled,
        /// <summary>Enabled and idle between checks — last check found the app up.</summary>
        Monitoring,
        /// <summary>Actively navigating/inspecting the deployed app URL right now.</summary>
        Checking,
        /// <summary>First check looked down; sitting in the 20s grace window before the confirming re-check.</summary>
        GracePeriod,
        /// <summary>Confirmed down — driving the Replit dashboard to click Run and waiting for the app to return.</summary>
        Waking,
        /// <summary>Something went wrong (WebView2 not ready, dashboard didn't load, Run button not found, wake timed out).</summary>
        Error,
    }

    /// <summary>A single status snapshot the watcher pushes to whoever renders its indicator (the MainWindow status bar).</summary>
    public class ReplitWatcherStatus
    {
        public ReplitWatcherState State { get; set; } = ReplitWatcherState.Disabled;
        public string Message { get; set; } = string.Empty;
        public DateTime? LastCheck { get; set; }
        public DateTime? LastIntervention { get; set; }
    }

    /// <summary>
    /// Git #902 (sub-issue of Epic #803) — Shane: "Replit shuts its dev mode
    /// down after like 10 minutes of inactivity. So I always have to turn it
    /// back on after a build. Can we use WebView2 to watch the site. When it
    /// sees the services off it waits 20 seconds then turns them back on."
    ///
    /// A background watcher, in the same in-process spirit as
    /// QueueWatcherService (#817): a DispatcherTimer drives periodic checks
    /// against the deployed app URL through a dedicated HIDDEN WebView2 hosted
    /// in MainWindow. That WebView2 is initialised through the SAME shared
    /// WebView2 environment (MainWindow.EnsureWebViewInitializedAsync, passed
    /// in as a delegate) as every visible tab, so it shares cookies/session —
    /// critical, because clicking Run on the Replit dashboard only works
    /// inside Shane's authenticated Replit session.
    ///
    /// Detection is CONTENT-based, not just HTTP status: a sleeping Repl can
    /// still answer 200 with a placeholder page, so we inspect the real page
    /// title/body text for Replit's idle-state markers (and treat a failed
    /// navigation as down too).
    ///
    /// Waking reuses the app's two proven WebView2 mechanisms unchanged:
    /// UiTestExecutor's CoreWebView2.Navigate() pattern (#832 — never set
    /// .Source, which no-ops when the URL is unchanged) and its
    /// querySelector→click JS-injection pattern. The Run-button selector is
    /// CONFIGURABLE (Settings) because its real value only exists inside the
    /// live authenticated IDE and can't be hardcoded from a sandbox.
    ///
    /// Logging channel: "replit-watcher" via ActivityLog.Log — every check,
    /// wake attempt, and outcome, per the issue.
    /// </summary>
    public class ReplitWatcherService
    {
        public const string Channel = "replit-watcher";

        private const int NavigationTimeoutMs = 20000;
        private const int GracePeriodMs = 20000;      // Shane's "waits 20 seconds"
        private const int DashboardSettleMs = 5000;   // let the IDE render before hunting for Run
        private const int WakeRecheckIntervalMs = 10000;
        private const int WakeMaxRechecks = 9;        // ~90s total for the Repl to come back

        // Best-effort idle markers. The real ones only surface in Shane's live
        // authenticated session, so every check logs the observed page title —
        // Shane can refine this list once he sees what a sleeping Repl actually
        // renders. Kept lowercase; matched as substrings against title+body.
        private static readonly string[] IdleMarkers =
        {
            "this repl is sleeping",
            "repl is sleeping",
            "is sleeping",
            "repl is asleep",
            "is not running",
            "no server is running",
            "run this repl",
            "run to see",
            "start this repl",
            "waking up",
            "this app is currently unavailable",
            "app is not running",
            "bad gateway",
            "service unavailable",
        };

        private readonly WebView2 _webView;
        private readonly Func<WebView2, Task<bool>> _ensureInitialized;
        private readonly DispatcherTimer _timer;
        private bool _busy;
        private DateTime? _lastCheck;
        private DateTime? _lastIntervention;

        public event Action<ReplitWatcherStatus>? StatusChanged;

        public ReplitWatcherService(WebView2 webView, Func<WebView2, Task<bool>> ensureInitialized)
        {
            _webView = webView;
            _ensureInitialized = ensureInitialized;
            _timer = new DispatcherTimer();
            _timer.Tick += async (_, _) => await TickAsync();
        }

        /// <summary>Reads current Settings and (re)starts or stops the timer accordingly. Called once at startup and again whenever Settings are saved, so toggling on/off and changing the interval take effect without a restart.</summary>
        public void ApplyConfig()
        {
            var s = BuildConsoleSettings.Load();
            _timer.Stop();

            if (!s.ReplitWatcherEnabled)
            {
                Emit(ReplitWatcherState.Disabled, "off");
                ActivityLog.Log(Channel, "Watcher is OFF (Settings). No checks will run.");
                return;
            }

            int mins = Math.Max(1, s.ReplitWatcherIntervalMinutes);
            _timer.Interval = TimeSpan.FromMinutes(mins);
            _timer.Start();
            Emit(ReplitWatcherState.Monitoring, $"watching every {mins} min");
            ActivityLog.Log(Channel, $"Watcher ON — polling {s.ReplitAppUrl} every {mins} min; wake target {s.ReplitWorkspaceUrl}; Run selector '{s.ReplitRunButtonSelector}'.");

            // Run one check immediately rather than waiting a whole interval.
            _ = TickAsync();
        }

        private async Task TickAsync()
        {
            // A wake sequence can take longer than the interval; never let ticks stack.
            if (_busy) return;

            var s = BuildConsoleSettings.Load();
            if (!s.ReplitWatcherEnabled)
            {
                _timer.Stop();
                Emit(ReplitWatcherState.Disabled, "off");
                return;
            }

            _busy = true;
            try
            {
                if (!await _ensureInitialized(_webView) || _webView.CoreWebView2 == null)
                {
                    Emit(ReplitWatcherState.Error, "WebView2 not ready");
                    ActivityLog.Log(Channel, "Check skipped — background WebView2 failed to initialise.");
                    return;
                }

                Emit(ReplitWatcherState.Checking, "checking app…");
                bool up = await IsAppUpAsync(s.ReplitAppUrl);
                _lastCheck = DateTime.Now;

                if (up)
                {
                    Emit(ReplitWatcherState.Monitoring, "app up");
                    return;
                }

                // Shane's "waits 20 seconds then turns them back on" — a grace
                // window so a normal brief blip doesn't trigger a needless wake.
                Emit(ReplitWatcherState.GracePeriod, "app looks down — re-checking in 20s");
                ActivityLog.Log(Channel, "App looked DOWN — waiting 20s grace, then re-checking once before waking.");
                await Task.Delay(GracePeriodMs);

                up = await IsAppUpAsync(s.ReplitAppUrl);
                _lastCheck = DateTime.Now;
                if (up)
                {
                    Emit(ReplitWatcherState.Monitoring, "recovered on its own");
                    ActivityLog.Log(Channel, "App recovered on its own during the grace window — no wake needed.");
                    return;
                }

                ActivityLog.Log(Channel, "Still DOWN after grace — attempting to wake the Repl via the dashboard.");
                await WakeAsync(s);
            }
            catch (Exception ex)
            {
                Emit(ReplitWatcherState.Error, ex.Message);
                ActivityLog.Log(Channel, $"Check/wake threw: {ex.Message}");
            }
            finally
            {
                _busy = false;
            }
        }

        /// <summary>Navigates the hidden WebView2 to the app URL and decides up/down from BOTH navigation success and the actual page content (a sleeping Repl can answer 200 with a placeholder).</summary>
        private async Task<bool> IsAppUpAsync(string url)
        {
            if (string.IsNullOrWhiteSpace(url))
            {
                ActivityLog.Log(Channel, "No app URL configured — cannot check; treating as down.");
                return false;
            }

            bool navigated = await NavigateAsync(url);
            if (!navigated)
            {
                ActivityLog.Log(Channel, $"Check: navigation to {url} failed/non-success — DOWN.");
                return false;
            }

            var (title, text) = await ReadPageAsync();
            string hay = ($"{title} {text}").ToLowerInvariant();
            foreach (var marker in IdleMarkers)
            {
                if (hay.Contains(marker))
                {
                    ActivityLog.Log(Channel, $"Check: idle marker '{marker}' found (title=\"{Trim(title)}\") — DOWN.");
                    return false;
                }
            }

            ActivityLog.Log(Channel, $"Check: app UP (title=\"{Trim(title)}\").");
            return true;
        }

        /// <summary>Drives the Replit dashboard to click Run, then polls the app URL until it comes back (or times out). Marks _lastIntervention the moment Run is actually clicked, regardless of outcome.</summary>
        private async Task WakeAsync(BuildConsoleSettings s)
        {
            Emit(ReplitWatcherState.Waking, "opening Replit dashboard…");
            if (!await NavigateAsync(s.ReplitWorkspaceUrl))
            {
                Emit(ReplitWatcherState.Error, "couldn't open Replit dashboard");
                ActivityLog.Log(Channel, $"Wake failed — navigation to dashboard {s.ReplitWorkspaceUrl} failed.");
                return;
            }

            // Give the IDE a moment to render its toolbar before we look for Run.
            await Task.Delay(DashboardSettleMs);

            var (clicked, detail) = await ClickRunAsync(s.ReplitRunButtonSelector);
            if (!clicked)
            {
                Emit(ReplitWatcherState.Error, "Run button not found — calibrate selector in Settings");
                ActivityLog.Log(Channel, $"Wake failed — could not find/click Run (selector '{s.ReplitRunButtonSelector}'): {detail}. Shane: calibrate the 'Replit Run Button Selector' in Settings against the live dashboard.");
                return;
            }

            _lastIntervention = DateTime.Now;
            ActivityLog.Log(Channel, $"Clicked Run ({detail}). Waiting up to {WakeMaxRechecks * WakeRecheckIntervalMs / 1000}s for the app to come back…");

            bool backUp = false;
            for (int i = 0; i < WakeMaxRechecks && !backUp; i++)
            {
                Emit(ReplitWatcherState.Waking, $"woke Repl — waiting for app ({i + 1}/{WakeMaxRechecks})");
                await Task.Delay(WakeRecheckIntervalMs);
                backUp = await IsAppUpAsync(s.ReplitAppUrl);
            }

            _lastCheck = DateTime.Now;
            if (backUp)
            {
                Emit(ReplitWatcherState.Monitoring, $"woke Repl at {_lastIntervention:HH:mm}");
                ActivityLog.Log(Channel, $"Wake SUCCEEDED — app is back up (intervened at {_lastIntervention:HH:mm:ss}).");
            }
            else
            {
                Emit(ReplitWatcherState.Error, "wake attempted, app still down");
                ActivityLog.Log(Channel, "Wake attempt made but app is STILL down after the wait window — Shane may need to check the Repl/selector manually.");
            }
        }

        /// <summary>Git #832 — must use CoreWebView2.Navigate(url), never set .Source (WPF skips the property-changed callback when the URL is unchanged, so a repeat check to the same URL would deadlock waiting for a NavigationCompleted that never fires).</summary>
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

        /// <summary>Reads the current page's title and (truncated) visible body text for content inspection.</summary>
        private async Task<(string title, string text)> ReadPageAsync()
        {
            const string script = @"
(function() {
    try {
        return JSON.stringify({
            title: document.title || '',
            text: (document.body ? (document.body.innerText || '') : '').slice(0, 3000)
        });
    } catch (ex) {
        return JSON.stringify({ title: '', text: '', error: ex.message });
    }
})();";

            var root = await EvalAsync(script);
            if (root == null) return (string.Empty, string.Empty);
            string title = root.Value.TryGetProperty("title", out var t) ? (t.GetString() ?? string.Empty) : string.Empty;
            string text = root.Value.TryGetProperty("text", out var x) ? (x.GetString() ?? string.Empty) : string.Empty;
            return (title, text);
        }

        /// <summary>Same querySelector→click JS-injection pattern UiTestExecutor uses, with a fallback that finds any button/anchor whose visible text is exactly "Run" when the configured selector matches nothing.</summary>
        private async Task<(bool clicked, string detail)> ClickRunAsync(string selector)
        {
            string script = $@"
(function() {{
    try {{
        var el = document.querySelector('{Escape(selector)}');
        var via = 'selector';
        if (!el) {{
            var candidates = document.querySelectorAll('button, [role=button], a');
            for (var i = 0; i < candidates.length; i++) {{
                var label = (candidates[i].innerText || candidates[i].textContent || '').trim().toLowerCase();
                if (label === 'run') {{ el = candidates[i]; via = 'text'; break; }}
            }}
        }}
        if (!el) return JSON.stringify({{ clicked: false, reason: 'no element matched selector or Run text' }});
        el.click();
        return JSON.stringify({{ clicked: true, via: via }});
    }} catch (ex) {{
        return JSON.stringify({{ clicked: false, reason: ex.message }});
    }}
}})();";

            var root = await EvalAsync(script);
            if (root == null) return (false, "script returned nothing");

            bool clicked = root.Value.TryGetProperty("clicked", out var c)
                           && (c.ValueKind == JsonValueKind.True);
            if (clicked)
            {
                string via = root.Value.TryGetProperty("via", out var v) ? (v.GetString() ?? "?") : "?";
                return (true, $"via {via}");
            }

            string reason = root.Value.TryGetProperty("reason", out var r) ? (r.GetString() ?? "unknown") : "unknown";
            return (false, reason);
        }

        /// <summary>Runs a JS snippet whose own return value is a JSON.stringify string, and unwraps the double JSON encoding ExecuteScriptAsync applies — identical handling to UiTestExecutor.</summary>
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

        private static string Escape(string s) => (s ?? string.Empty).Replace("\\", "\\\\").Replace("'", "\\'");

        private static string Trim(string s) =>
            string.IsNullOrEmpty(s) ? "" : (s.Length > 80 ? s.Substring(0, 80) + "…" : s);

        private void Emit(ReplitWatcherState state, string message)
        {
            StatusChanged?.Invoke(new ReplitWatcherStatus
            {
                State = state,
                Message = message,
                LastCheck = _lastCheck,
                LastIntervention = _lastIntervention,
            });
        }
    }
}

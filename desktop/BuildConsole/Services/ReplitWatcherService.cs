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

        public ReplitWatcherStatus CurrentStatus { get; private set; } = new ReplitWatcherStatus();

        public event Action<ReplitWatcherStatus>? StatusChanged;

        /// <summary>Delegate to open or focus the visible 'Replit Workspace' tab in MainWindow so the user can watch the wake sequence live.</summary>
        public Func<Task<WebView2?>>? OpenVisibleWorkspaceTab { get; set; }

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

        /// <summary>Triggers an immediate wake sequence to start Replit without waiting for a timer tick or grace period. Can be called when any health check or test runner determines Replit is down.</summary>
        public async Task<bool> TriggerWakeAsync()
        {
            if (_busy)
            {
                ActivityLog.Log(Channel, "Wake/check already in progress — waiting for current operation.");
                return CurrentStatus.State == ReplitWatcherState.Monitoring;
            }

            var s = BuildConsoleSettings.Load();
            _busy = true;
            try
            {
                if (!await _ensureInitialized(_webView) || _webView.CoreWebView2 == null)
                {
                    Emit(ReplitWatcherState.Error, "WebView2 not ready");
                    return false;
                }

                ActivityLog.Log(Channel, "Replit down intervention triggered — driving Replit dashboard to turn app on...");
                await WakeAsync(s);
                return CurrentStatus.State == ReplitWatcherState.Monitoring;
            }
            catch (Exception ex)
            {
                Emit(ReplitWatcherState.Error, ex.Message);
                ActivityLog.Log(Channel, $"TriggerWake failed: {ex.Message}");
                return false;
            }
            finally
            {
                _busy = false;
            }
        }

        /// <summary>Checks whether Replit is up immediately. If down, immediately launches the wake sequence to turn Replit on.</summary>
        public async Task<bool> CheckNowAndWakeIfDownAsync()
        {
            if (_busy) return CurrentStatus.State == ReplitWatcherState.Monitoring;

            var s = BuildConsoleSettings.Load();
            _busy = true;
            try
            {
                if (!await _ensureInitialized(_webView) || _webView.CoreWebView2 == null)
                {
                    Emit(ReplitWatcherState.Error, "WebView2 not ready");
                    return false;
                }

                Emit(ReplitWatcherState.Checking, "checking app…");
                bool up = await IsAppUpAsync(s.ReplitAppUrl);
                _lastCheck = DateTime.Now;

                if (up)
                {
                    Emit(ReplitWatcherState.Monitoring, "app up");
                    return true;
                }

                ActivityLog.Log(Channel, "Replit determined DOWN — immediately initiating wake sequence.");
                await WakeAsync(s);
                return CurrentStatus.State == ReplitWatcherState.Monitoring;
            }
            catch (Exception ex)
            {
                Emit(ReplitWatcherState.Error, ex.Message);
                ActivityLog.Log(Channel, $"CheckNowAndWakeIfDown failed: {ex.Message}");
                return false;
            }
            finally
            {
                _busy = false;
            }
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

            // Open or focus the visible Replit Workspace tab so the user can watch the wake sequence live
            WebView2 targetWv = _webView;
            if (OpenVisibleWorkspaceTab != null)
            {
                try
                {
                    var visibleWv = await OpenVisibleWorkspaceTab();
                    if (visibleWv != null)
                    {
                        await _ensureInitialized(visibleWv);
                        targetWv = visibleWv;
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(Channel, $"Opening visible Replit tab warning: {ex.Message}");
                }
            }

            if (!await NavigateAsync(s.ReplitWorkspaceUrl, targetWv))
            {
                Emit(ReplitWatcherState.Error, "couldn't open Replit dashboard");
                ActivityLog.Log(Channel, $"Wake failed — navigation to dashboard {s.ReplitWorkspaceUrl} failed.");
                return;
            }

            // Give the IDE a moment to render its toolbar before we look for Run.
            await Task.Delay(DashboardSettleMs);

            var (clicked, detail) = await ClickRunAsync(s.ReplitRunButtonSelector, targetWv);
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
        private async Task<bool> NavigateAsync(string url, WebView2? wv = null)
        {
            var target = wv ?? _webView;
            if (target.CoreWebView2 == null) return false;

            var tcs = new TaskCompletionSource<bool>();
            void NavHandler(object? sender, CoreWebView2NavigationCompletedEventArgs args)
            {
                target.NavigationCompleted -= NavHandler;
                tcs.TrySetResult(args.IsSuccess);
            }

            target.NavigationCompleted += NavHandler;
            try
            {
                target.CoreWebView2.Navigate(url);
            }
            catch (Exception ex)
            {
                target.NavigationCompleted -= NavHandler;
                ActivityLog.Log(Channel, $"Navigate({url}) threw: {ex.Message}");
                return false;
            }

            var completed = await Task.WhenAny(tcs.Task, Task.Delay(NavigationTimeoutMs));
            if (completed != tcs.Task)
            {
                target.NavigationCompleted -= NavHandler;
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

        /// <summary>Same querySelector→click JS-injection pattern UiTestExecutor uses, with multi-strategy fallback scoped specifically to the 'Project' workflow row, Replit's theme-positive button pills, aria-labels, and text variants.</summary>
        private async Task<(bool clicked, string detail)> ClickRunAsync(string selector, WebView2? wv = null)
        {
            string script = $@"
(function() {{
    try {{
        var el = null;
        var via = '';
        var sel = '{Escape(selector)}'.trim();
        if (sel) {{
            try {{ el = document.querySelector(sel); }} catch (_) {{}}
            if (el) via = 'configured selector';
        }}

        // Helper to ensure an element is a real button and NOT an accordion toggle header
        function isRealButton(node) {{
            if (!node || node.nodeType !== 1) return false;
            if (node.tagName !== 'BUTTON') return false;
            if (node.id && node.id.includes('AccordionControl')) return false;
            if (node.className && typeof node.className === 'string' && node.className.includes('accordionToggle')) return false;
            var aria = (node.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('accordion') || aria.includes('collapse') || aria.includes('expand')) return false;
            return true;
        }}

        // Priority 1: Match button[aria-label=""Run workflow""] or button[aria-label*=""Run workflow""]
        if (!el) {{
            var runButtons = Array.from(document.querySelectorAll('button[aria-label=""Run workflow""], button[aria-label*=""Run workflow"" i], button[aria-label=""Run Project"" i]'))
                .filter(isRealButton);

            if (runButtons.length === 1) {{
                el = runButtons[0];
                via = 'exact button[aria-label=""Run workflow""]';
            }} else if (runButtons.length > 1) {{
                // Find 'Project' label node and pick the button belonging to the same workflow container
                var allTextNodes = Array.from(document.querySelectorAll('span, div, p'));
                var projectLabel = allTextNodes.find(function(node) {{
                    return node.children.length === 0 && (node.textContent || '').trim() === 'Project';
                }});
                if (projectLabel) {{
                    var curr = projectLabel;
                    while (curr && curr !== document.body && !el) {{
                        var match = Array.from(curr.querySelectorAll('button[aria-label*=""workflow"" i], button[aria-label*=""run"" i]'))
                            .find(isRealButton);
                        if (match) {{
                            el = match;
                            via = 'Project row button[aria-label=""' + match.getAttribute('aria-label') + '""]';
                            break;
                        }}
                        curr = curr.parentElement;
                    }}
                }}
                if (!el) {{
                    el = runButtons[0];
                    via = 'first button[aria-label=""Run workflow""]';
                }}
            }}
        }}

        // Priority 2: Look for SVG play button (triangle path) in the Project workflow row
        if (!el) {{
            var allTextNodes = Array.from(document.querySelectorAll('span, div, p'));
            var projectLabel = allTextNodes.find(function(node) {{
                return node.children.length === 0 && (node.textContent || '').trim() === 'Project';
            }});
            if (projectLabel) {{
                var curr = projectLabel;
                while (curr && curr !== document.body && !el) {{
                    var candidates = Array.from(curr.querySelectorAll('button')).filter(isRealButton);
                    for (var i = 0; i < candidates.length; i++) {{
                        var btn = candidates[i];
                        if (btn.querySelector('path[d*=""20.593""], path[d*=""8.145""], path[d*=""14.48""]') || 
                            btn.classList.contains('_sdz_theme-positive') ||
                            (btn.getAttribute('aria-label') || '').toLowerCase().includes('run')) {{
                            el = btn;
                            via = 'Project section play button (' + (btn.getAttribute('aria-label') || 'play SVG') + ')';
                            break;
                        }}
                    }}
                    curr = curr.parentElement;
                }}
            }}
        }}

        // Priority 3: Fallback across page buttons
        if (!el) {{
            var globalCandidates = Array.from(document.querySelectorAll('button')).filter(isRealButton);
            for (var i = 0; i < globalCandidates.length; i++) {{
                var btn = globalCandidates[i];
                var aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                var txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                if (aria.includes('run workflow') || aria.includes('start workflow') || txt === 'run button' || txt === 'run') {{
                    el = btn;
                    via = 'global button (' + (btn.getAttribute('aria-label') || txt) + ')';
                    break;
                }}
            }}
        }}

        if (!el) return JSON.stringify({{ clicked: false, reason: 'no real play/run button found in Project workflow' }});
        
        try {{ el.focus(); }} catch (_) {{}}
        el.dispatchEvent(new MouseEvent('mousedown', {{ bubbles: true, cancelable: true }}));
        el.dispatchEvent(new MouseEvent('mouseup', {{ bubbles: true, cancelable: true }}));
        el.click();
        return JSON.stringify({{ clicked: true, via: via }});
    }} catch (ex) {{
        return JSON.stringify({{ clicked: false, reason: ex.message }});
    }}
}})();";

            var root = await EvalAsync(script, wv);
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
        private async Task<JsonElement?> EvalAsync(string script, WebView2? wv = null)
        {
            var target = wv ?? _webView;
            try
            {
                string resJson = await target.ExecuteScriptAsync(script) ?? string.Empty;
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
            CurrentStatus = new ReplitWatcherStatus
            {
                State = state,
                Message = message,
                LastCheck = _lastCheck,
                LastIntervention = _lastIntervention,
            };
            StatusChanged?.Invoke(CurrentStatus);
        }
    }
}

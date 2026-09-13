using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    /// <summary>
    /// Item representing an observed API request failure, non-200 response, or slow response.
    /// </summary>
    public sealed class AutomationApiFailureItem
    {
        public string Name { get; set; } = string.Empty;
        public string RequestUrl { get; set; } = string.Empty;
        public string Method { get; set; } = "GET";
        public int StatusCode { get; set; }
        public long DurationMs { get; set; }
        public string Reason { get; set; } = string.Empty; // "Non-200", "Failed", "Slow"
        public Dictionary<string, string> RequestHeaders { get; set; } = new();
        public Dictionary<string, string> ResponseHeaders { get; set; } = new();
        public string? ResponseBody { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.Now;
    }

    /// <summary>
    /// Item representing a captured DOM snapshot or diff during automated execution.
    /// </summary>
    public sealed class AutomationDomDiffItem
    {
        public int StepIndex { get; set; }
        public string Route { get; set; } = string.Empty;
        public string Selector { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public int AddedElementsCount { get; set; }
        public int RemovedElementsCount { get; set; }
        public int ModifiedElementsCount { get; set; }
        public List<string> Changes { get; set; } = new();
        public string? SnapshotPath { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.Now;
    }

    /// <summary>
    /// Real-time telemetry observer attached to WebView2 during automated UI tests.
    /// Captures console errors, non-200 / failed / slow network responses, and DOM diff snapshots
    /// without replacing or interfering with Playwright or underlying test execution.
    /// </summary>
    public sealed class UiAutomationTelemetryObserver : IDisposable
    {
        private const string Channel = "testing.automation-telemetry";
        private readonly WebView2 _webView;
        private readonly int _slowApiThresholdMs;
        private bool _isAttached;
        private string? _consoleScriptId;

        private readonly ConcurrentBag<ConsoleLogItem> _consoleErrors = new();
        private readonly ConcurrentBag<AutomationApiFailureItem> _apiFailures = new();
        private readonly ConcurrentDictionary<string, Stopwatch> _inFlightRequests = new();
        private readonly List<AutomationDomDiffItem> _domDiffs = new();
        private readonly HashSet<string> _visitedUrls = new(StringComparer.OrdinalIgnoreCase);

        public IReadOnlyList<ConsoleLogItem> ConsoleErrors => _consoleErrors.OrderBy(c => c.Timestamp).ToList();
        public IReadOnlyList<AutomationApiFailureItem> ApiFailures => _apiFailures.OrderBy(a => a.Timestamp).ToList();
        public IReadOnlyList<AutomationDomDiffItem> DomDiffs => _domDiffs;
        public IReadOnlyList<string> VisitedUrls => _visitedUrls.ToList();

        public UiAutomationTelemetryObserver(WebView2 webView, int slowApiThresholdMs = 1500)
        {
            _webView = webView ?? throw new ArgumentNullException(nameof(webView));
            _slowApiThresholdMs = slowApiThresholdMs > 0 ? slowApiThresholdMs : 1500;
        }

        /// <summary>
        /// Attaches network and console listeners to the WebView2 control.
        /// </summary>
        public async Task AttachAsync()
        {
            if (_isAttached) return;

            try
            {
                await MainWindow.EnsureWebViewInitializedAsync(_webView);
                if (_webView.CoreWebView2 == null) return;

                // 1. Hook network response receiver
                _webView.CoreWebView2.WebResourceResponseReceived += CoreWebView2_WebResourceResponseReceived;

                // 2. Inject console error capture script on document created
                const string errorInterceptorJs = @"
(function() {
    if (window.__qaAutomationInjected) return;
    window.__qaAutomationInjected = true;
    window.__qaConsoleErrors = window.__qaConsoleErrors || [];

    var origError = console.error;
    console.error = function() {
        try {
            var args = Array.prototype.slice.call(arguments);
            var msg = args.map(function(a) {
                if (a instanceof Error) return a.stack || a.message;
                if (typeof a === 'object') {
                    try { return JSON.stringify(a); } catch(_) { return String(a); }
                }
                return String(a);
            }).join(' ');

            window.__qaConsoleErrors.push({
                level: 'error',
                message: msg,
                source: 'console.error',
                stack: (new Error()).stack || '',
                timestamp: new Date().toISOString()
            });
        } catch(_) {}
        if (origError) origError.apply(console, arguments);
    };

    window.addEventListener('error', function(e) {
        try {
            window.__qaConsoleErrors.push({
                level: 'error',
                message: e.message || (e.error ? e.error.message : 'Uncaught error'),
                source: (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0),
                stack: e.error ? e.error.stack || '' : '',
                timestamp: new Date().toISOString()
            });
        } catch(_) {}
    });

    window.addEventListener('unhandledrejection', function(e) {
        try {
            var reason = e.reason;
            window.__qaConsoleErrors.push({
                level: 'error',
                message: 'Unhandled Promise Rejection: ' + (reason ? (reason.stack || reason.message || String(reason)) : 'unknown'),
                source: 'unhandledrejection',
                stack: reason && reason.stack ? reason.stack : '',
                timestamp: new Date().toISOString()
            });
        } catch(_) {}
    });
})();";

                _consoleScriptId = await _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(errorInterceptorJs);

                // Run immediately on current page as well
                try
                {
                    await _webView.CoreWebView2.ExecuteScriptAsync(errorInterceptorJs);
                }
                catch { }

                // Track initial URL
                TrackUrl(_webView.CoreWebView2.Source);

                _isAttached = true;
                ActivityLog.Log(Channel, "Attached automated QA telemetry observer to WebView2.");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Failed to attach automated QA telemetry observer: {ex.Message}");
            }
        }

        public void TrackUrl(string? url)
        {
            if (string.IsNullOrWhiteSpace(url) || url == "about:blank") return;
            _visitedUrls.Add(url.Trim());
        }

        private async void CoreWebView2_WebResourceResponseReceived(object? sender, CoreWebView2WebResourceResponseReceivedEventArgs e)
        {
            try
            {
                string url = e.Request.Uri;
                int statusCode = e.Response.StatusCode;
                string method = e.Request.Method;

                // Ignore data URLs and static font/image assets unless they errored
                if (url.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) return;

                bool isNon200 = statusCode >= 400 || statusCode == 0;

                // Read response headers
                var respHeaders = new Dictionary<string, string>();
                foreach (var h in e.Response.Headers)
                {
                    respHeaders[h.Key] = h.Value;
                }

                var reqHeaders = new Dictionary<string, string>();
                foreach (var h in e.Request.Headers)
                {
                    reqHeaders[h.Key] = h.Value;
                }

                // Check for slow API response
                long elapsedMs = 0;
                if (_inFlightRequests.TryRemove(url, out var sw))
                {
                    sw.Stop();
                    elapsedMs = sw.ElapsedMilliseconds;
                }

                bool isSlow = elapsedMs >= _slowApiThresholdMs && (url.Contains("/api/") || url.Contains("/graphql"));

                if (isNon200 || isSlow)
                {
                    string reason = isNon200 ? $"HTTP {statusCode}" : $"Slow API ({elapsedMs}ms > {_slowApiThresholdMs}ms)";
                    string name = MakeApiName(url, method);

                    string? body = null;
                    if (isNon200 && (url.Contains("/api/") || url.Contains("/auth/") || statusCode >= 500))
                    {
                        try
                        {
                            using var stream = await e.Response.GetContentAsync();
                            if (stream != null)
                            {
                                using var reader = new StreamReader(stream);
                                var raw = await reader.ReadToEndAsync();
                                if (!string.IsNullOrEmpty(raw))
                                {
                                    body = raw.Length > 2000 ? raw.Substring(0, 2000) + "… [truncated]" : raw;
                                }
                            }
                        }
                        catch { }
                    }

                    var failureItem = new AutomationApiFailureItem
                    {
                        Name = name,
                        RequestUrl = url,
                        Method = method,
                        StatusCode = statusCode,
                        DurationMs = elapsedMs,
                        Reason = reason,
                        RequestHeaders = reqHeaders,
                        ResponseHeaders = respHeaders,
                        ResponseBody = body,
                        Timestamp = DateTime.Now
                    };

                    _apiFailures.Add(failureItem);
                    ActivityLog.Log(Channel, $"Captured API problem: [{method} {statusCode}] {url} ({reason})");
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Error in WebResourceResponseReceived telemetry: {ex.Message}");
            }
        }

        /// <summary>
        /// Collects all in-page buffered console errors.
        /// </summary>
        public async Task PullInPageConsoleErrorsAsync()
        {
            if (_webView.CoreWebView2 == null) return;
            try
            {
                string json = await _webView.CoreWebView2.ExecuteScriptAsync(@"
(function() {
    var errs = window.__qaConsoleErrors || [];
    window.__qaConsoleErrors = [];
    return JSON.stringify(errs);
})();") ?? "[]";

                if (string.IsNullOrWhiteSpace(json) || json == "null") return;

                using var outer = JsonDocument.Parse(json);
                string innerJson = outer.RootElement.GetString() ?? "[]";
                using var doc = JsonDocument.Parse(innerJson);

                if (doc.RootElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in doc.RootElement.EnumerateArray())
                    {
                        string msg = item.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "";
                        string src = item.TryGetProperty("source", out var s) ? s.GetString() ?? "" : "";
                        string stack = item.TryGetProperty("stack", out var st) ? st.GetString() ?? "" : "";

                        if (!string.IsNullOrWhiteSpace(msg))
                        {
                            _consoleErrors.Add(new ConsoleLogItem
                            {
                                Level = "error",
                                Message = string.IsNullOrWhiteSpace(src) ? msg : $"[{src}] {msg}",
                                StackTrace = stack,
                                Timestamp = DateTime.Now.ToString("o")
                            });
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Failed to pull in-page console errors: {ex.Message}");
            }
        }

        /// <summary>
        /// Captures a DOM snapshot and records structural differences.
        /// </summary>
        public async Task<AutomationDomDiffItem?> CaptureDomSnapshotAsync(int stepIndex, string selector, string description)
        {
            if (_webView.CoreWebView2 == null) return null;

            try
            {
                string script = @"
(function() {
    try {
        var el = document.querySelector('" + EscapeJs(selector) + @"') || document.body;
        var tagCounts = {};
        var all = el.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
            var tag = all[i].tagName.toLowerCase();
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        }

        return JSON.stringify({
            totalElements: all.length,
            tagCounts: tagCounts,
            title: document.title || '',
            url: window.location.href,
            textSummary: (el.innerText || '').slice(0, 300)
        });
    } catch(ex) {
        return JSON.stringify({ error: ex.message });
    }
})();";

                string rawResult = await _webView.CoreWebView2.ExecuteScriptAsync(script) ?? "{}";
                using var outer = JsonDocument.Parse(rawResult);
                string inner = outer.RootElement.GetString() ?? "{}";

                var diffItem = new AutomationDomDiffItem
                {
                    StepIndex = stepIndex,
                    Route = _webView.CoreWebView2.Source ?? "",
                    Selector = selector,
                    Description = description,
                    Timestamp = DateTime.Now
                };

                try
                {
                    using var dataDoc = JsonDocument.Parse(inner);
                    if (dataDoc.RootElement.TryGetProperty("totalElements", out var totalEl))
                    {
                        diffItem.ModifiedElementsCount = totalEl.GetInt32();
                        diffItem.Changes.Add($"Captured DOM scope: {totalEl.GetInt32()} total element nodes under '{selector}'.");
                    }
                }
                catch { }

                _domDiffs.Add(diffItem);
                return diffItem;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"CaptureDomSnapshotAsync warning: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Executes an optional DevTools JS command against the active page.
        /// </summary>
        public async Task<DevToolsRunnerService.ConsoleExecutionResult> ExecuteJsCommandAsync(string script)
        {
            return await DevToolsRunnerService.ExecuteConsoleAsync(_webView, script);
        }

        /// <summary>
        /// Executes an optional DevTools fetch() API call.
        /// </summary>
        public async Task<DevToolsRunnerService.ApiResponseResult> ExecuteApiCallAsync(string url, string method = "GET", string? body = null)
        {
            return await DevToolsRunnerService.ExecuteApiAsync(_webView, url, body, method);
        }

        private static string MakeApiName(string url, string method)
        {
            try
            {
                var uri = new Uri(url);
                var path = uri.AbsolutePath.Trim('/').Replace('/', '-');
                if (string.IsNullOrEmpty(path)) path = "root";
                return $"{method.ToLowerInvariant()}-{path}";
            }
            catch
            {
                return $"{method.ToLowerInvariant()}-api-request";
            }
        }

        private static string EscapeJs(string s) => (s ?? string.Empty).Replace("'", "\\'").Replace("\n", " ").Replace("\r", "");

        public void Dispose()
        {
            if (!_isAttached) return;
            try
            {
                if (_webView.CoreWebView2 != null)
                {
                    _webView.CoreWebView2.WebResourceResponseReceived -= CoreWebView2_WebResourceResponseReceived;
                    if (!string.IsNullOrEmpty(_consoleScriptId))
                    {
                        try { _webView.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(_consoleScriptId); } catch { }
                    }
                }
            }
            catch { }
            _isAttached = false;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    /// <summary>
    /// Telemetry &amp; diagnostic observer service for WebView2 in the Visual Test Tracker.
    /// Intercepts:
    /// 1. Console errors, warnings, uncaught exceptions, and unhandled promise rejections.
    /// 2. Failed network requests (fetch/XHR with HTTP status >= 400 or network drops).
    /// 3. User interaction breadcrumbs (clicks, inputs, form submissions with target selectors).
    /// 4. Environment &amp; page metadata (URL, page title, user agent, viewport and screen dimensions).
    /// </summary>
    public static class VisualTestTrackerTelemetry
    {
        private const string ObserverScript = @"
(function() {
    if (window.__vttTelemetryInstalled) return;
    window.__vttTelemetryInstalled = true;

    window.__vttTelemetry = {
        consoleLogs: [],
        networkFailures: [],
        reproductionEvents: []
    };

    var maxItems = 60;

    function getNow() {
        var d = new Date();
        return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    // ── 1. Console & Exception Interceptors ──────────────────────────────
    var origError = console.error;
    console.error = function() {
        try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
                var a = arguments[i];
                if (typeof a === 'object') {
                    try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
                } else {
                    parts.push(String(a));
                }
            }
            window.__vttTelemetry.consoleLogs.push({
                level: 'error',
                message: parts.join(' '),
                timestamp: getNow()
            });
            if (window.__vttTelemetry.consoleLogs.length > maxItems) window.__vttTelemetry.consoleLogs.shift();
        } catch (e) {}
        if (origError) origError.apply(console, arguments);
    };

    var origWarn = console.warn;
    console.warn = function() {
        try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
                var a = arguments[i];
                if (typeof a === 'object') {
                    try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
                } else {
                    parts.push(String(a));
                }
            }
            window.__vttTelemetry.consoleLogs.push({
                level: 'warn',
                message: parts.join(' '),
                timestamp: getNow()
            });
            if (window.__vttTelemetry.consoleLogs.length > maxItems) window.__vttTelemetry.consoleLogs.shift();
        } catch (e) {}
        if (origWarn) origWarn.apply(console, arguments);
    };

    window.addEventListener('error', function(evt) {
        try {
            var msg = (evt.message || 'Error') + (evt.filename ? ' (' + evt.filename + ':' + evt.lineno + ')' : '');
            window.__vttTelemetry.consoleLogs.push({
                level: 'exception',
                message: msg,
                timestamp: getNow()
            });
            if (window.__vttTelemetry.consoleLogs.length > maxItems) window.__vttTelemetry.consoleLogs.shift();
        } catch (e) {}
    });

    window.addEventListener('unhandledrejection', function(evt) {
        try {
            var msg = 'Unhandled Rejection: ';
            if (evt.reason) {
                msg += evt.reason.message || String(evt.reason);
            } else {
                msg += 'Unknown';
            }
            window.__vttTelemetry.consoleLogs.push({
                level: 'unhandledrejection',
                message: msg,
                timestamp: getNow()
            });
            if (window.__vttTelemetry.consoleLogs.length > maxItems) window.__vttTelemetry.consoleLogs.shift();
        } catch (e) {}
    });

    // ── 2. Network Interceptors (fetch & XHR) ────────────────────────────
    if (window.fetch) {
        var origFetch = window.fetch;
        window.fetch = function() {
            var args = arguments;
            var url = 'unknown';
            var method = 'GET';
            try {
                if (typeof args[0] === 'string') url = args[0];
                else if (args[0] && args[0].url) url = args[0].url;
                if (args[1] && args[1].method) method = args[1].method;
                else if (args[0] && args[0].method) method = args[0].method;
            } catch (e) {}

            return origFetch.apply(this, args).then(function(res) {
                try {
                    if (!res.ok) {
                        window.__vttTelemetry.networkFailures.push({
                            method: String(method).toUpperCase(),
                            url: String(url),
                            status: res.status,
                            statusText: res.statusText || 'HTTP Error',
                            timestamp: getNow()
                        });
                        if (window.__vttTelemetry.networkFailures.length > maxItems) window.__vttTelemetry.networkFailures.shift();
                    }
                } catch (e) {}
                return res;
            }).catch(function(err) {
                try {
                    window.__vttTelemetry.networkFailures.push({
                        method: String(method).toUpperCase(),
                        url: String(url),
                        status: 0,
                        statusText: err ? (err.message || 'Network Failure') : 'Network Failure',
                        timestamp: getNow()
                    });
                    if (window.__vttTelemetry.networkFailures.length > maxItems) window.__vttTelemetry.networkFailures.shift();
                } catch (e) {}
                throw err;
            });
        };
    }

    if (window.XMLHttpRequest) {
        var origOpen = XMLHttpRequest.prototype.open;
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function(method, url) {
            this.__vttMethod = method;
            this.__vttUrl = url;
            return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function() {
            var self = this;
            this.addEventListener('loadend', function() {
                try {
                    if (self.status >= 400 || self.status === 0) {
                        window.__vttTelemetry.networkFailures.push({
                            method: (self.__vttMethod || 'GET').toUpperCase(),
                            url: String(self.__vttUrl || ''),
                            status: self.status,
                            statusText: self.statusText || (self.status === 0 ? 'Network Drop' : 'HTTP Error'),
                            timestamp: getNow()
                        });
                        if (window.__vttTelemetry.networkFailures.length > maxItems) window.__vttTelemetry.networkFailures.shift();
                    }
                } catch (e) {}
            });
            return origSend.apply(this, arguments);
        };
    }

    // ── 3. Reproduction Event Breadcrumbs ─────────────────────────────────
    function describeElement(el) {
        if (!el || !el.tagName) return 'unknown';
        var desc = el.tagName.toLowerCase();
        if (el.id) desc += '#' + el.id;
        if (el.className && typeof el.className === 'string') {
            var classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
            if (classes) desc += '.' + classes;
        }
        return desc;
    }

    function elementDetails(el) {
        if (!el) return '';
        if (el.type === 'password') return 'value=""••••••""';
        var text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
        if (text.length > 50) text = text.substring(0, 47) + '...';
        return text;
    }

    document.addEventListener('click', function(evt) {
        try {
            var target = evt.target;
            window.__vttTelemetry.reproductionEvents.push({
                eventType: 'click',
                target: describeElement(target),
                details: elementDetails(target),
                timestamp: getNow()
            });
            if (window.__vttTelemetry.reproductionEvents.length > maxItems) window.__vttTelemetry.reproductionEvents.shift();
        } catch (e) {}
    }, true);

    document.addEventListener('change', function(evt) {
        try {
            var target = evt.target;
            window.__vttTelemetry.reproductionEvents.push({
                eventType: 'change',
                target: describeElement(target),
                details: elementDetails(target),
                timestamp: getNow()
            });
            if (window.__vttTelemetry.reproductionEvents.length > maxItems) window.__vttTelemetry.reproductionEvents.shift();
        } catch (e) {}
    }, true);

    document.addEventListener('submit', function(evt) {
        try {
            var target = evt.target;
            window.__vttTelemetry.reproductionEvents.push({
                eventType: 'submit',
                target: describeElement(target),
                details: target.action || '',
                timestamp: getNow()
            });
            if (window.__vttTelemetry.reproductionEvents.length > maxItems) window.__vttTelemetry.reproductionEvents.shift();
        } catch (e) {}
    }, true);
})();
";

        private const string CollectorScript = @"
(function() {
    var tel = window.__vttTelemetry || { consoleLogs: [], networkFailures: [], reproductionEvents: [] };
    return JSON.stringify({
        url: window.location.href || '',
        title: document.title || '',
        userAgent: navigator.userAgent || '',
        innerWidth: window.innerWidth || 0,
        innerHeight: window.innerHeight || 0,
        outerWidth: window.outerWidth || 0,
        outerHeight: window.outerHeight || 0,
        screenWidth: window.screen ? window.screen.width : 0,
        screenHeight: window.screen ? window.screen.height : 0,
        consoleLogs: tel.consoleLogs || [],
        networkFailures: tel.networkFailures || [],
        reproductionEvents: tel.reproductionEvents || []
    });
})();
";

        private const string CountsScript = @"
(function() {
    var tel = window.__vttTelemetry || { consoleLogs: [], networkFailures: [], reproductionEvents: [] };
    return JSON.stringify({
        errors: (tel.consoleLogs || []).filter(function(l) { return l.level === 'error' || l.level === 'exception' || l.level === 'unhandledrejection'; }).length,
        network: (tel.networkFailures || []).length,
        events: (tel.reproductionEvents || []).length
    });
})();
";

        public sealed class TelemetrySnapshot
        {
            public string Url { get; set; } = "";
            public string Title { get; set; } = "";
            public string UserAgent { get; set; } = "";
            public int InnerWidth { get; set; }
            public int InnerHeight { get; set; }
            public int OuterWidth { get; set; }
            public int OuterHeight { get; set; }
            public int ScreenWidth { get; set; }
            public int ScreenHeight { get; set; }
            public List<ConsoleLogItem> ConsoleLogs { get; set; } = new();
            public List<NetworkFailureItem> NetworkFailures { get; set; } = new();
            public List<ReproductionEventItem> ReproductionEvents { get; set; } = new();
        }

        public sealed class TelemetryCounts
        {
            public int Errors { get; set; }
            public int Network { get; set; }
            public int Events { get; set; }
        }

        /// <summary>Injects the observer script into the active WebView2 page.</summary>
        public static async Task InjectObserverAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return;
            try
            {
                await webView.ExecuteScriptAsync(ObserverScript);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Telemetry observer injection error: {ex.Message}");
            }
        }

        /// <summary>Captures a complete snapshot of diagnostics, user agent, viewport size, and logs.</summary>
        public static async Task<TelemetrySnapshot> CollectSnapshotAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return new TelemetrySnapshot();

            try
            {
                var rawResult = await webView.ExecuteScriptAsync(CollectorScript);
                if (string.IsNullOrWhiteSpace(rawResult) || rawResult == "null")
                    return new TelemetrySnapshot();

                // ExecuteScriptAsync returns a JSON-encoded string literal if the script returned JSON.stringify
                string jsonToParse = rawResult;
                if (rawResult.StartsWith("\"") && rawResult.EndsWith("\""))
                {
                    try
                    {
                        var unescaped = JsonSerializer.Deserialize<string>(rawResult);
                        if (!string.IsNullOrEmpty(unescaped)) jsonToParse = unescaped;
                    }
                    catch { }
                }

                var snapshot = JsonSerializer.Deserialize<TelemetrySnapshot>(jsonToParse, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                return snapshot ?? new TelemetrySnapshot();
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Telemetry collection error: {ex.Message}");
                return new TelemetrySnapshot();
            }
        }

        /// <summary>Fetches lightweight counts of captured diagnostics for UI badge displays.</summary>
        public static async Task<TelemetryCounts> GetCountsAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return new TelemetryCounts();

            try
            {
                var raw = await webView.ExecuteScriptAsync(CountsScript);
                if (string.IsNullOrWhiteSpace(raw) || raw == "null") return new TelemetryCounts();

                string json = raw;
                if (raw.StartsWith("\"") && raw.EndsWith("\""))
                {
                    try
                    {
                        var unescaped = JsonSerializer.Deserialize<string>(raw);
                        if (!string.IsNullOrEmpty(unescaped)) json = unescaped;
                    }
                    catch { }
                }

                var counts = JsonSerializer.Deserialize<TelemetryCounts>(json, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });

                return counts ?? new TelemetryCounts();
            }
            catch
            {
                return new TelemetryCounts();
            }
        }
    }
}

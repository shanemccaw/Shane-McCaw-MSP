using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    /// <summary>
    /// Automatic Telemetry &amp; Diagnostics Capture for WebView2 in Visual Test Tracker.
    /// Captures:
    /// 1. Console logs (Errors, Warnings, Info/Debug logs, and Stack Traces).
    /// 2. Network logs (Failed requests, Status codes, URLs, Timing durations in ms, and Payload sizes).
    /// 3. JavaScript errors (Uncaught exceptions, unhandled Promise rejections, and script execution errors).
    /// 4. Performance signals (Page load time, TTFB, DOMContentLoaded, FCP, LCP, and script error count).
    /// 5. User interaction breadcrumbs (clicks, inputs with password redaction, form submits).
    /// 6. Auto-collected environment &amp; viewport metadata.
    /// </summary>
    public static class VisualTestTrackerTelemetry
    {
        private const string ObserverScript = @"
(function() {
    if (window.__vttTelemetryInstalled) return;
    window.__vttTelemetryInstalled = true;

    window.__vttTelemetry = {
        consoleLogs: [],
        networkLogs: [],
        reproductionEvents: [],
        scriptErrors: 0,
        lcp: 0
    };

    var maxItems = 80;

    function getNow() {
        var d = new Date();
        return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function extractStackTrace(err) {
        if (err && err.stack) {
            return String(err.stack).replace(/^Error\n/, '');
        }
        try {
            throw new Error();
        } catch (e) {
            if (e.stack) {
                var lines = e.stack.split('\n');
                return lines.slice(3, 8).join('\n');
            }
        }
        return '';
    }

    // ── 1. Performance Observer for LCP ───────────────────────────────────
    try {
        if (window.PerformanceObserver) {
            var lcpObserver = new PerformanceObserver(function(entryList) {
                var entries = entryList.getEntries();
                if (entries && entries.length > 0) {
                    window.__vttTelemetry.lcp = Math.round(entries[entries.length - 1].startTime);
                }
            });
            lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
        }
    } catch (e) {}

    // ── 2. Console Interceptors (Errors, Warnings, Info, Logs, Stack Traces)
    function interceptConsole(level, origFn) {
        return function() {
            try {
                var parts = [];
                var stack = '';
                for (var i = 0; i < arguments.length; i++) {
                    var a = arguments[i];
                    if (a instanceof Error) {
                        parts.push(a.message || String(a));
                        if (!stack) stack = a.stack || '';
                    } else if (typeof a === 'object') {
                        try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
                    } else {
                        parts.push(String(a));
                    }
                }
                if (!stack && (level === 'error' || level === 'warn')) {
                    stack = extractStackTrace();
                }
                window.__vttTelemetry.consoleLogs.push({
                    level: level,
                    message: parts.join(' '),
                    stackTrace: stack,
                    timestamp: getNow()
                });
                if (window.__vttTelemetry.consoleLogs.length > maxItems) window.__vttTelemetry.consoleLogs.shift();
            } catch (e) {}
            if (origFn) origFn.apply(console, arguments);
        };
    }

    var origError = console.error;
    console.error = interceptConsole('error', origError);

    var origWarn = console.warn;
    console.warn = interceptConsole('warn', origWarn);

    var origInfo = console.info;
    console.info = interceptConsole('info', origInfo);

    var origLog = console.log;
    console.log = interceptConsole('log', origLog);

    // ── 3. JavaScript Errors: Uncaught Exceptions & Promise Rejections ────
    window.addEventListener('error', function(evt) {
        try {
            window.__vttTelemetry.scriptErrors++;
            var msg = evt.message || 'Script Execution Error';
            var location = evt.filename ? (evt.filename + ':' + evt.lineno + (evt.colno ? ':' + evt.colno : '')) : '';
            var stack = evt.error && evt.error.stack ? evt.error.stack : (location ? 'at ' + location : '');
            window.__vttTelemetry.consoleLogs.push({
                level: 'exception',
                message: msg + (location ? ' (' + location + ')' : ''),
                stackTrace: stack,
                timestamp: getNow()
            });
            if (window.__vttTelemetry.consoleLogs.length > maxItems) window.__vttTelemetry.consoleLogs.shift();
        } catch (e) {}
    });

    window.addEventListener('unhandledrejection', function(evt) {
        try {
            window.__vttTelemetry.scriptErrors++;
            var reason = evt.reason;
            var msg = 'Unhandled Promise Rejection';
            var stack = '';
            if (reason instanceof Error) {
                msg = 'Unhandled Promise Rejection: ' + (reason.message || reason.name);
                stack = reason.stack || '';
            } else if (reason) {
                msg = 'Unhandled Promise Rejection: ' + String(reason);
            }
            window.__vttTelemetry.consoleLogs.push({
                level: 'unhandledrejection',
                message: msg,
                stackTrace: stack,
                timestamp: getNow()
            });
            if (window.__vttTelemetry.consoleLogs.length > maxItems) window.__vttTelemetry.consoleLogs.shift();
        } catch (e) {}
    });

    // ── 4. Network Interceptors: Status, URLs, Timing, Payload Size ──────
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

            var t0 = (window.performance && performance.now) ? performance.now() : Date.now();

            return origFetch.apply(this, args).then(function(res) {
                try {
                    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
                    var durationMs = Math.round(t1 - t0);
                    var sizeHeader = res.headers ? res.headers.get('content-length') : null;
                    var payloadSize = sizeHeader ? formatBytes(parseInt(sizeHeader, 10)) : '';

                    var isFailed = !res.ok;
                    window.__vttTelemetry.networkLogs.push({
                        method: String(method).toUpperCase(),
                        url: String(url),
                        status: res.status,
                        statusText: res.statusText || (isFailed ? 'HTTP Error' : 'OK'),
                        durationMs: durationMs,
                        payloadSize: payloadSize,
                        timestamp: getNow(),
                        failed: isFailed
                    });
                    if (window.__vttTelemetry.networkLogs.length > maxItems) window.__vttTelemetry.networkLogs.shift();
                } catch (e) {}
                return res;
            }).catch(function(err) {
                try {
                    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
                    var durationMs = Math.round(t1 - t0);
                    window.__vttTelemetry.networkLogs.push({
                        method: String(method).toUpperCase(),
                        url: String(url),
                        status: 0,
                        statusText: err ? (err.message || 'Network Drop') : 'Network Drop',
                        durationMs: durationMs,
                        payloadSize: '',
                        timestamp: getNow(),
                        failed: true
                    });
                    if (window.__vttTelemetry.networkLogs.length > maxItems) window.__vttTelemetry.networkLogs.shift();
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
            var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
            this.addEventListener('loadend', function() {
                try {
                    var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
                    var durationMs = Math.round(t1 - t0);
                    var sizeHeader = self.getResponseHeader('Content-Length');
                    var payloadBytes = sizeHeader ? parseInt(sizeHeader, 10) : (self.responseText ? self.responseText.length : 0);
                    var isFailed = self.status >= 400 || self.status === 0;

                    window.__vttTelemetry.networkLogs.push({
                        method: (self.__vttMethod || 'GET').toUpperCase(),
                        url: String(self.__vttUrl || ''),
                        status: self.status,
                        statusText: self.statusText || (self.status === 0 ? 'Network Drop' : (isFailed ? 'HTTP Error' : 'OK')),
                        durationMs: durationMs,
                        payloadSize: formatBytes(payloadBytes),
                        timestamp: getNow(),
                        failed: isFailed
                    });
                    if (window.__vttTelemetry.networkLogs.length > maxItems) window.__vttTelemetry.networkLogs.shift();
                } catch (e) {}
            });
            return origSend.apply(this, arguments);
        };
    }

    // ── 5. User Interaction Breadcrumbs ──────────────────────────────────
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
    var tel = window.__vttTelemetry || { consoleLogs: [], networkLogs: [], reproductionEvents: [], scriptErrors: 0, lcp: 0 };
    
    // Calculate performance navigation metrics
    var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || performance.timing;
    var perf = {
        pageLoadTimeMs: 0,
        dnsTimeMs: 0,
        tcpTimeMs: 0,
        ttfbMs: 0,
        domContentLoadedMs: 0,
        firstContentfulPaintMs: 0,
        largestContentfulPaintMs: tel.lcp || 0,
        scriptErrorCount: tel.scriptErrors || 0
    };

    if (nav) {
        if (nav.duration) {
            perf.pageLoadTimeMs = Math.round(nav.duration);
            perf.dnsTimeMs = Math.round(nav.domainLookupEnd - nav.domainLookupStart);
            perf.tcpTimeMs = Math.round(nav.connectEnd - nav.connectStart);
            perf.ttfbMs = Math.round(nav.responseStart - nav.requestStart);
            perf.domContentLoadedMs = Math.round(nav.domContentLoadedEventEnd - nav.startTime);
        } else if (nav.navigationStart) {
            perf.pageLoadTimeMs = Math.max(0, nav.loadEventEnd - nav.navigationStart);
            perf.dnsTimeMs = Math.max(0, nav.domainLookupEnd - nav.domainLookupStart);
            perf.tcpTimeMs = Math.max(0, nav.connectEnd - nav.connectStart);
            perf.ttfbMs = Math.max(0, nav.responseStart - nav.requestStart);
            perf.domContentLoadedMs = Math.max(0, nav.domContentLoadedEventEnd - nav.navigationStart);
        }
    }

    try {
        var paint = performance.getEntriesByType ? performance.getEntriesByType('paint') : [];
        for (var i = 0; i < paint.length; i++) {
            if (paint[i].name === 'first-contentful-paint') {
                perf.firstContentfulPaintMs = Math.round(paint[i].startTime);
            }
        }
    } catch (e) {}

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
        networkLogs: tel.networkLogs || [],
        reproductionEvents: tel.reproductionEvents || [],
        performance: perf
    });
})();
";

        private const string CountsScript = @"
(function() {
    var tel = window.__vttTelemetry || { consoleLogs: [], networkLogs: [], reproductionEvents: [], scriptErrors: 0, lcp: 0 };
    var logs = tel.consoleLogs || [];
    var net = tel.networkLogs || [];
    var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || performance.timing;
    var loadTime = 0;
    if (nav) {
        loadTime = nav.duration ? Math.round(nav.duration) : (nav.loadEventEnd && nav.navigationStart ? Math.max(0, nav.loadEventEnd - nav.navigationStart) : 0);
    }

    return JSON.stringify({
        errors: logs.filter(function(l) { return l.level === 'error' || l.level === 'exception' || l.level === 'unhandledrejection'; }).length,
        warnings: logs.filter(function(l) { return l.level === 'warn'; }).length,
        networkFailures: net.filter(function(n) { return n.failed; }).length,
        totalNetwork: net.length,
        events: (tel.reproductionEvents || []).length,
        pageLoadMs: loadTime,
        lcpMs: tel.lcp || 0
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
            public List<NetworkFailureItem> NetworkLogs { get; set; } = new();
            public List<ReproductionEventItem> ReproductionEvents { get; set; } = new();
            public PerformanceSignals? Performance { get; set; }
        }

        public sealed class TelemetryCounts
        {
            public int Errors { get; set; }
            public int Warnings { get; set; }
            public int NetworkFailures { get; set; }
            public int TotalNetwork { get; set; }
            public int Events { get; set; }
            public double PageLoadMs { get; set; }
            public double LcpMs { get; set; }
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

        /// <summary>Captures a complete snapshot of diagnostics, user agent, viewport size, performance signals, and logs.</summary>
        public static async Task<TelemetrySnapshot> CollectSnapshotAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return new TelemetrySnapshot();

            try
            {
                var rawResult = await webView.ExecuteScriptAsync(CollectorScript);
                if (string.IsNullOrWhiteSpace(rawResult) || rawResult == "null")
                    return new TelemetrySnapshot();

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

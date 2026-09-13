using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BuildConsole.Services
{
    /// <summary>
    /// Represents detailed metadata and dimensions of an inspected DOM element.
    /// </summary>
    public sealed class DomElementInfo
    {
        public string Tag { get; set; } = "";
        public string Id { get; set; } = "";
        public string Classes { get; set; } = "";
        public string Selector { get; set; } = "";
        public string XPath { get; set; } = "";
        public string OuterHtml { get; set; } = "";
        public string InnerText { get; set; } = "";
        public double Width { get; set; }
        public double Height { get; set; }
        public double Left { get; set; }
        public double Top { get; set; }
        public double DevicePixelRatio { get; set; } = 1.0;
        public Dictionary<string, string> Attributes { get; set; } = new();
    }

    /// <summary>
    /// Record of a DOM mutation (added element, modified attribute, or changed text) captured in-page.
    /// </summary>
    public sealed class DomMutationRecord
    {
        public string Id { get; set; } = Guid.NewGuid().ToString("N");
        public string Type { get; set; } = ""; // "childList", "attributes", "characterData"
        public string Action { get; set; } = ""; // "added", "modified", "removed"
        public string Tag { get; set; } = "";
        public string Selector { get; set; } = "";
        public string TargetDescription { get; set; } = "";
        public string AttributeName { get; set; } = "";
        public string OldValue { get; set; } = "";
        public string NewValue { get; set; } = "";
        public string Timestamp { get; set; } = "";
    }

    /// <summary>
    /// Represents an accessibility violation discovered during an in-page WCAG 2.1 AA audit.
    /// </summary>
    public sealed class AccessibilityViolation
    {
        public string Id { get; set; } = Guid.NewGuid().ToString("N");
        public string Category { get; set; } = ""; // "MissingAlt", "Contrast", "Aria"
        public string Rule { get; set; } = ""; // "img-missing-alt", "color-contrast", "interactive-missing-name", etc.
        public string Severity { get; set; } = "Error"; // "Error", "Warning"
        public string Selector { get; set; } = "";
        public string Tag { get; set; } = "";
        public string Message { get; set; } = "";
        public string Details { get; set; } = "";
        public string Snippet { get; set; } = "";
        public double ContrastRatio { get; set; }
        public string FgColor { get; set; } = "";
        public string BgColor { get; set; } = "";
        public double BoundingTop { get; set; }
        public double BoundingLeft { get; set; }
        public double BoundingWidth { get; set; }
        public double BoundingHeight { get; set; }
    }

    /// <summary>
    /// Full audit report containing all detected accessibility violations for a tested page.
    /// </summary>
    public sealed class AccessibilityAuditReport
    {
        public string Url { get; set; } = "";
        public string Timestamp { get; set; } = "";
        public int TotalViolations => Violations.Count;
        public int MissingAltCount => Violations.Count(v => v.Category == "MissingAlt");
        public int ContrastCount => Violations.Count(v => v.Category == "Contrast");
        public int AriaCount => Violations.Count(v => v.Category == "Aria");
        public List<AccessibilityViolation> Violations { get; set; } = new();
    }

    /// <summary>
    /// Automatic Telemetry, Chrome DevTools Protocol (CDP) &amp; Diagnostics Capture for WebView2 in Visual Test Tracker.
    /// Captures:
    /// 1. Console logs (Runtime.consoleAPICalled, Console.messageAdded with stack traces).
    /// 2. Network logs (Network.requestWillBeSent, responseReceived, loadingFailed with timing &amp; payload sizes).
    /// 3. JavaScript errors (Runtime.exceptionThrown for engine-level uncaught exceptions &amp; unhandled rejections).
    /// 4. Early JS injection (AddScriptToExecuteOnDocumentCreatedAsync) for bulletproof reproduction tracking.
    /// 5. Interactive DOM element inspector (hover-highlighting, selector generation, outerHTML capture).
    /// 6. Performance navigation signals (page load time, TTFB, DOMContentLoaded, FCP, LCP).
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

    // ── 5. Automated Reproduction Step Tracking ──────────────────────────
    function getUniqueSelector(el) {
        if (!el || el.nodeType !== 1) return '';
        if (el.id) return '#' + CSS.escape(el.id);

        var path = [];
        var curr = el;
        while (curr && curr.nodeType === 1 && curr !== document.body && curr !== document.documentElement) {
            var sel = curr.tagName.toLowerCase();
            if (curr.id) {
                path.unshift('#' + CSS.escape(curr.id));
                break;
            }
            if (curr.className && typeof curr.className === 'string') {
                var classes = curr.className.trim().split(/\s+/).filter(Boolean);
                if (classes.length > 0) {
                    sel += '.' + classes.slice(0, 2).map(function(c) {
                        try { return CSS.escape(c); } catch(e) { return c; }
                    }).join('.');
                }
            }
            if (curr.name && typeof curr.name === 'string') {
                sel += '[name=""' + curr.name + '""]';
            }
            if (curr.getAttribute && curr.getAttribute('data-testid')) {
                sel = '[data-testid=""' + curr.getAttribute('data-testid') + '""]';
                path.unshift(sel);
                break;
            }
            var parent = curr.parentNode;
            if (parent && parent.children) {
                var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === curr.tagName; });
                if (siblings.length > 1) {
                    var idx = siblings.indexOf(curr) + 1;
                    sel += ':nth-of-type(' + idx + ')';
                }
            }
            path.unshift(sel);
            curr = parent;
            if (path.length >= 4) break;
        }
        return path.join(' > ');
    }

    function getSanitizedOuterHtml(el) {
        if (!el || !el.outerHTML) return '';
        try {
            var clone = el.cloneNode(false);
            if (clone.type === 'password' || (clone.name && String(clone.name).toLowerCase().includes('password'))) {
                clone.value = '••••••';
                if (clone.hasAttribute('value')) clone.setAttribute('value', '••••••');
            }
            var html = clone.outerHTML || '';
            if (html.length > 180) {
                html = html.substring(0, 177) + '...';
            }
            return html;
        } catch (e) {
            return '<' + (el.tagName ? el.tagName.toLowerCase() : 'element') + '>';
        }
    }

    function recordReproductionStep(actionType, targetEl, details) {
        try {
            var step = {
                actionType: actionType,
                selector: getUniqueSelector(targetEl),
                outerHtml: getSanitizedOuterHtml(targetEl),
                details: details || '',
                timestamp: getNow()
            };
            window.__vttTelemetry.reproductionEvents.push(step);
            if (window.__vttTelemetry.reproductionEvents.length > maxItems) {
                window.__vttTelemetry.reproductionEvents.shift();
            }
        } catch (e) {}
    }

    // Clicks & Button Presses
    document.addEventListener('click', function(evt) {
        try {
            var target = evt.target;
            if (!target) return;
            var buttonEl = target.closest ? target.closest('button, [role=""button""], input[type=""button""], input[type=""submit""], input[type=""reset""]') : null;
            if (buttonEl) {
                var btnText = (buttonEl.innerText || buttonEl.value || buttonEl.getAttribute('aria-label') || '').trim();
                if (btnText.length > 40) btnText = btnText.substring(0, 37) + '...';
                recordReproductionStep('BUTTON_PRESS', buttonEl, btnText ? 'Button: ""' + btnText + '""' : 'Button pressed');
            } else {
                var text = (target.innerText || target.getAttribute('aria-label') || target.title || '').trim();
                if (text.length > 40) text = text.substring(0, 37) + '...';
                var action = target.tagName && target.tagName.toLowerCase() === 'a' ? 'LINK_CLICK' : 'CLICK';
                recordReproductionStep(action, target, text ? '""' + text + '""' : '');
            }
        } catch (e) {}
    }, true);

    // Keyboard Button Presses (Enter or Space on focused button/link)
    document.addEventListener('keydown', function(evt) {
        try {
            if (evt.key === 'Enter' || evt.key === ' ') {
                var target = evt.target;
                if (target && target.closest) {
                    var btn = target.closest('button, [role=""button""], a, input[type=""submit""]');
                    if (btn) {
                        var text = (btn.innerText || btn.value || '').trim();
                        recordReproductionStep('BUTTON_PRESS', btn, 'Key [' + evt.key + ']' + (text ? ' on ""' + text + '""' : ''));
                    }
                }
            }
        } catch (e) {}
    }, true);

    // Form Inputs & Changes (with automatic password redaction)
    document.addEventListener('change', function(evt) {
        try {
            var target = evt.target;
            if (!target || !target.tagName) return;
            var tag = target.tagName.toLowerCase();
            var details = '';
            if (target.type === 'password' || (target.name && String(target.name).toLowerCase().includes('password'))) {
                details = 'Password changed (••••••)';
            } else if (target.type === 'checkbox') {
                details = target.checked ? 'Checked' : 'Unchecked';
            } else if (target.type === 'radio') {
                details = 'Selected radio value=""' + (target.value || '') + '""';
            } else if (tag === 'select') {
                var selOption = target.options && target.selectedIndex >= 0 ? target.options[target.selectedIndex].text : target.value;
                details = 'Selected option ""' + selOption + '""';
            } else {
                var val = String(target.value || '').trim();
                if (val.length > 40) val = val.substring(0, 37) + '...';
                details = val ? 'value=""' + val + '""' : 'Cleared input';
            }
            recordReproductionStep('INPUT', target, details);
        } catch (e) {}
    }, true);

    // Navigation Events (pushState, replaceState, popstate, hashchange)
    var origPushState = history.pushState;
    if (origPushState) {
        history.pushState = function(state, unused, url) {
            try {
                recordReproductionStep('NAVIGATE', document.body, 'pushState: ' + String(url || window.location.pathname));
            } catch (e) {}
            return origPushState.apply(this, arguments);
        };
    }
    var origReplaceState = history.replaceState;
    if (origReplaceState) {
        history.replaceState = function(state, unused, url) {
            try {
                recordReproductionStep('NAVIGATE', document.body, 'replaceState: ' + String(url || window.location.pathname));
            } catch (e) {}
            return origReplaceState.apply(this, arguments);
        };
    }
    window.addEventListener('popstate', function() {
        try {
            recordReproductionStep('NAVIGATE', document.body, 'popstate: ' + window.location.pathname + window.location.search);
        } catch (e) {}
    });
    window.addEventListener('hashchange', function() {
        try {
            recordReproductionStep('NAVIGATE', document.body, 'hashchange: ' + window.location.hash);
        } catch (e) {}
    });

    // Form Submissions
    document.addEventListener('submit', function(evt) {
        try {
            var form = evt.target;
            var action = (form && form.getAttribute ? form.getAttribute('action') : '') || '';
            var method = (form && form.getAttribute ? form.getAttribute('method') : 'GET') || 'GET';
            recordReproductionStep('SUBMIT', form || document.body, 'Form submitted (' + method.toUpperCase() + (action ? ' -> ' + action : '') + ')');
        } catch (e) {}
    }, true);

    // DOM Changes (Modals, Dialogs, Alerts, Toasts appearing)
    try {
        if (window.MutationObserver && document.body) {
            var lastMutationTime = 0;
            var mutObserver = new MutationObserver(function(mutations) {
                var now = Date.now();
                if (now - lastMutationTime < 400) return;
                for (var i = 0; i < mutations.length; i++) {
                    var m = mutations[i];
                    if (m.type === 'childList' && m.addedNodes) {
                        for (var j = 0; j < m.addedNodes.length; j++) {
                            var n = m.addedNodes[j];
                            if (n.nodeType === 1) {
                                var role = n.getAttribute ? n.getAttribute('role') : '';
                                var cls = (n.className && typeof n.className === 'string') ? n.className.toLowerCase() : '';
                                var isAlertOrModal = role === 'dialog' || role === 'alert' || role === 'alertdialog' ||
                                    cls.includes('modal') || cls.includes('dialog') || cls.includes('toast') ||
                                    cls.includes('alert') || cls.includes('error') || cls.includes('banner');
                                if (isAlertOrModal) {
                                    lastMutationTime = now;
                                    var snippet = (n.innerText || '').trim();
                                    if (snippet.length > 50) snippet = snippet.substring(0, 47) + '...';
                                    recordReproductionStep('DOM_MUTATION', n, (snippet ? 'Rendered: ""' + snippet + '""' : 'Added to DOM'));
                                    return;
                                }
                            }
                        }
                    }
                }
            });
            mutObserver.observe(document.body, { childList: true, subtree: true });
        }
    } catch (e) {}
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

        private const string DomInspectorScript = @"
(function() {
    if (window.__vttDomInspectorCleanUp) {
        window.__vttDomInspectorCleanUp();
    }
    window.__vttDomInspectorActive = true;
    window.__vttDomStickyInspector = true;

    var isLocked = false;
    var hoveredEl = null;
    var selectedEl = null;
    var currentPayload = null;

    var overlay = document.getElementById('__vtt_dom_inspector_overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = '__vtt_dom_inspector_overlay';
        overlay.style.position = 'fixed';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '2147483645';
        overlay.style.border = '2px solid #38bdf8';
        overlay.style.backgroundColor = 'rgba(56, 189, 248, 0.15)';
        overlay.style.borderRadius = '3px';
        overlay.style.transition = 'top 0.05s ease-out, left 0.05s ease-out, width 0.05s ease-out, height 0.05s ease-out';
        overlay.style.display = 'none';
        overlay.style.boxSizing = 'border-box';

        var badge = document.createElement('div');
        badge.id = '__vtt_dom_inspector_badge';
        badge.style.position = 'absolute';
        badge.style.top = '-24px';
        badge.style.left = '0';
        badge.style.backgroundColor = '#0f172a';
        badge.style.color = '#38bdf8';
        badge.style.fontFamily = 'Consolas, monospace';
        badge.style.fontSize = '11px';
        badge.style.fontWeight = 'bold';
        badge.style.padding = '2px 6px';
        badge.style.borderRadius = '3px';
        badge.style.whiteSpace = 'nowrap';
        badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
        badge.style.pointerEvents = 'none';
        overlay.appendChild(badge);

        document.documentElement.appendChild(overlay);
    }

    var noteCard = document.getElementById('__vtt_dom_note_card');
    if (!noteCard) {
        noteCard = document.createElement('div');
        noteCard.id = '__vtt_dom_note_card';
        noteCard.style.position = 'fixed';
        noteCard.style.zIndex = '2147483647';
        noteCard.style.width = '340px';
        noteCard.style.boxSizing = 'border-box';
        noteCard.style.backgroundColor = '#0f172a';
        noteCard.style.border = '1px solid #38bdf8';
        noteCard.style.borderRadius = '8px';
        noteCard.style.boxShadow = '0 12px 30px rgba(0,0,0,0.7), 0 0 0 1px rgba(56, 189, 248, 0.2)';
        noteCard.style.padding = '10px 12px';
        noteCard.style.fontFamily = '-apple-system, BlinkMacSystemFont, ""Segoe UI"", Roboto, Helvetica, Arial, sans-serif';
        noteCard.style.display = 'none';
        noteCard.style.color = '#f8fafc';

        noteCard.innerHTML = `
            <div style=""display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;"">
                <div style=""display:flex; align-items:center; overflow:hidden;"">
                    <span id=""__vtt_card_tag"" style=""font-family:Consolas, monospace; font-size:11.5px; font-weight:700; color:#38bdf8; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:200px;"">element</span>
                    <span id=""__vtt_card_dims"" style=""font-size:10px; color:#94a3b8; margin-left:6px; white-space:nowrap;"">0×0px</span>
                </div>
                <button id=""__vtt_card_close"" title=""Cancel note and unselect (Esc)"" style=""background:none; border:none; color:#94a3b8; font-size:14px; cursor:pointer; padding:1px 5px; border-radius:3px; line-height:1;"">✕</button>
            </div>
            <div id=""__vtt_card_selector"" style=""font-family:Consolas, monospace; font-size:9.5px; color:#64748b; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; margin-bottom:6px;"">selector</div>
            <textarea id=""__vtt_card_input"" placeholder=""Type bug note... (Enter to send, Shift+Enter for newline, Esc to cancel)"" style=""width:100%; box-sizing:border-box; height:50px; min-height:44px; max-height:110px; background:#1e293b; border:1px solid #334155; border-radius:5px; color:#f8fafc; font-size:11.5px; padding:6px 8px; resize:vertical; outline:none; font-family:inherit; line-height:1.35;""></textarea>
            <div style=""display:flex; justify-content:space-between; align-items:center; margin-top:8px;"">
                <div>
                    <button id=""__vtt_card_add_step"" title=""Add to repro steps in composer"" style=""background:#1e293b; border:1px solid #334155; color:#94a3b8; font-size:10px; font-weight:600; padding:3px 7px; border-radius:4px; cursor:pointer;"">+ Step</button>
                </div>
                <div style=""display:flex; gap:6px; align-items:center;"">
                    <button id=""__vtt_card_cancel"" style=""background:none; border:none; color:#94a3b8; font-size:10.5px; cursor:pointer; padding:3px 6px;"">Cancel (Esc)</button>
                    <button id=""__vtt_card_send"" style=""background:#0284c7; border:none; color:#ffffff; font-size:10.5px; font-weight:700; padding:4px 10px; border-radius:4px; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,0.3);"">Send Bug (Enter)</button>
                </div>
            </div>
        `;

        document.documentElement.appendChild(noteCard);

        var closeBtn = document.getElementById('__vtt_card_close');
        var cancelBtn = document.getElementById('__vtt_card_cancel');
        var sendBtn = document.getElementById('__vtt_card_send');
        var addStepBtn = document.getElementById('__vtt_card_add_step');
        var noteInput = document.getElementById('__vtt_card_input');

        if (closeBtn) closeBtn.addEventListener('click', function(ev) { ev.stopPropagation(); cancelNote(); });
        if (cancelBtn) cancelBtn.addEventListener('click', function(ev) { ev.stopPropagation(); cancelNote(); });
        if (sendBtn) sendBtn.addEventListener('click', function(ev) { ev.stopPropagation(); submitBug(); });
        if (addStepBtn) {
            addStepBtn.addEventListener('click', function(ev) {
                ev.stopPropagation();
                if (currentPayload && window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
                    window.chrome.webview.postMessage(JSON.stringify({
                        type: 'VTT_DOM_ADD_STEP',
                        data: { step: 'Click element `' + currentPayload.selector + '`' }
                    }));
                    addStepBtn.innerText = '✓ Added';
                    setTimeout(function() { addStepBtn.innerText = '+ Step'; }, 1500);
                }
            });
        }

        if (noteInput) {
            noteInput.addEventListener('keydown', function(ev) {
                ev.stopPropagation();
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    cancelNote();
                } else if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    submitBug();
                }
            });
        }

        noteCard.addEventListener('click', function(ev) { ev.stopPropagation(); });
        noteCard.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
    }

    function cancelNote() {
        isLocked = false;
        selectedEl = null;
        if (noteCard) noteCard.style.display = 'none';
        if (overlay) overlay.style.display = 'none';

        if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
            window.chrome.webview.postMessage(JSON.stringify({
                type: 'VTT_DOM_INSPECT_CANCEL'
            }));
        }
    }

    function submitBug() {
        var noteInput = document.getElementById('__vtt_card_input');
        var comment = noteInput ? noteInput.value.trim() : '';

        // Hide overlay and card immediately before screenshot is captured
        if (noteCard) noteCard.style.display = 'none';
        if (overlay) overlay.style.display = 'none';

        var payloadToSend = currentPayload;
        isLocked = false;
        selectedEl = null;

        if (payloadToSend && window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
            window.chrome.webview.postMessage(JSON.stringify({
                type: 'VTT_DOM_BUG_SUBMIT',
                data: {
                    comment: comment,
                    element: payloadToSend
                }
            }));
        }
    }

    function getSelector(el) {
        if (!el || el.nodeType !== 1) return '';
        if (el.id) return '#' + CSS.escape(el.id);
        var path = [];
        var curr = el;
        while (curr && curr.nodeType === 1 && curr !== document.body && curr !== document.documentElement) {
            var sel = curr.tagName.toLowerCase();
            if (curr.id) {
                path.unshift('#' + CSS.escape(curr.id));
                break;
            }
            if (curr.getAttribute && curr.getAttribute('data-testid')) {
                path.unshift('[data-testid=""' + curr.getAttribute('data-testid') + '""]');
                break;
            }
            if (curr.className && typeof curr.className === 'string') {
                var cls = curr.className.trim().split(/\s+/).filter(Boolean);
                if (cls.length > 0) sel += '.' + cls.slice(0, 2).map(function(c) { try { return CSS.escape(c); } catch(e) { return c; } }).join('.');
            }
            var parent = curr.parentNode;
            if (parent && parent.children) {
                var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === curr.tagName; });
                if (siblings.length > 1) {
                    var idx = siblings.indexOf(curr) + 1;
                    sel += ':nth-of-type(' + idx + ')';
                }
            }
            path.unshift(sel);
            curr = parent;
            if (path.length >= 4) break;
        }
        return path.join(' > ');
    }

    function getXPath(el) {
        if (!el || el.nodeType !== 1) return '';
        if (el.id) return '//*[@id=""' + el.id + '""]';
        var segs = [];
        for (; el && el.nodeType === 1; el = el.parentNode) {
            if (el.id) {
                segs.unshift('*[@id=""' + el.id + '""]');
                return '/' + segs.join('/');
            }
            var i = 1;
            for (var sib = el.previousSibling; sib; sib = sib.previousSibling) {
                if (sib.nodeType === 1 && sib.tagName === el.tagName) i++;
            }
            segs.unshift(el.tagName.toLowerCase() + '[' + i + ']');
        }
        return '/' + segs.join('/');
    }

    function getAttributes(el) {
        var attrs = {};
        if (el && el.attributes) {
            for (var i = 0; i < el.attributes.length; i++) {
                var a = el.attributes[i];
                attrs[a.name] = a.value;
            }
        }
        return attrs;
    }

    function onMouseMove(e) {
        if (!window.__vttDomInspectorActive || isLocked) return;
        var target = document.elementFromPoint(e.clientX, e.clientY);
        if (!target || target === overlay || overlay.contains(target) || target === noteCard || (noteCard && noteCard.contains(target))) return;
        hoveredEl = target;
        var rect = target.getBoundingClientRect();
        overlay.style.display = 'block';
        overlay.style.border = '2px solid #38bdf8';
        overlay.style.boxShadow = 'none';
        overlay.style.backgroundColor = 'rgba(56, 189, 248, 0.15)';
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        overlay.style.width = Math.max(0, rect.width) + 'px';
        overlay.style.height = Math.max(0, rect.height) + 'px';

        var badge = document.getElementById('__vtt_dom_inspector_badge');
        if (badge) {
            var tagStr = target.tagName.toLowerCase();
            if (target.id) tagStr += '#' + target.id;
            else if (target.className && typeof target.className === 'string') {
                var firstClass = target.className.trim().split(/\s+/)[0];
                if (firstClass) tagStr += '.' + firstClass;
            }
            tagStr += ' | ' + Math.round(rect.width) + ' × ' + Math.round(rect.height);
            badge.innerText = tagStr;
            if (rect.top < 26) {
                badge.style.top = '2px';
                badge.style.bottom = 'auto';
            } else {
                badge.style.top = '-24px';
                badge.style.bottom = 'auto';
            }
        }
    }

    function onClick(e) {
        if (!window.__vttDomInspectorActive) return;
        if (noteCard && (e.target === noteCard || noteCard.contains(e.target))) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (isLocked) {
            cancelNote();
            return;
        }

        var el = hoveredEl || e.target;
        if (!el || el === document.documentElement || el === document.body) return;

        isLocked = true;
        selectedEl = el;

        var rect = el.getBoundingClientRect();
        var outer = el.outerHTML || '';
        if (outer.length > 500) outer = outer.substring(0, 497) + '...';

        currentPayload = {
            tag: el.tagName ? el.tagName.toUpperCase() : '',
            id: el.id || '',
            classes: typeof el.className === 'string' ? el.className.trim() : '',
            selector: getSelector(el),
            xpath: getXPath(el),
            outerHtml: outer,
            innerText: (el.innerText || el.textContent || '').trim().substring(0, 200),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            devicePixelRatio: window.devicePixelRatio || 1,
            attributes: getAttributes(el)
        };

        // Locked highlight overlay
        overlay.style.display = 'block';
        overlay.style.border = '2px solid #0ea5e9';
        overlay.style.boxShadow = '0 0 0 3px rgba(14, 165, 233, 0.4)';
        overlay.style.backgroundColor = 'rgba(14, 165, 233, 0.2)';
        overlay.style.top = rect.top + 'px';
        overlay.style.left = rect.left + 'px';
        overlay.style.width = Math.max(0, rect.width) + 'px';
        overlay.style.height = Math.max(0, rect.height) + 'px';

        var badge = document.getElementById('__vtt_dom_inspector_badge');
        if (badge) {
            badge.innerText = 'LOCKED: ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
        }

        // Populate card
        var cardTag = document.getElementById('__vtt_card_tag');
        var cardDims = document.getElementById('__vtt_card_dims');
        var cardSel = document.getElementById('__vtt_card_selector');
        var cardInput = document.getElementById('__vtt_card_input');

        if (cardTag) cardTag.innerText = el.tagName.toLowerCase() + (el.id ? '#' + el.id : (el.className && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : ''));
        if (cardDims) cardDims.innerText = Math.round(rect.width) + ' × ' + Math.round(rect.height) + 'px';
        if (cardSel) cardSel.innerText = currentPayload.selector;
        if (cardInput) cardInput.value = '';

        var cardWidth = 340;
        var cardHeight = 150;
        var topPos = (rect.top > cardHeight + 12) ? (rect.top - cardHeight - 8) : Math.min(window.innerHeight - cardHeight - 10, rect.bottom + 8);
        var leftPos = Math.max(10, Math.min(window.innerWidth - cardWidth - 10, rect.left));

        noteCard.style.top = Math.round(topPos) + 'px';
        noteCard.style.left = Math.round(leftPos) + 'px';
        noteCard.style.display = 'block';

        setTimeout(function() {
            if (cardInput) cardInput.focus();
        }, 30);

        if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
            window.chrome.webview.postMessage(JSON.stringify({
                type: 'VTT_DOM_INSPECT',
                data: currentPayload
            }));
        }
    }

    function onGlobalKeyDown(ev) {
        if (ev.key === 'Escape' && isLocked) {
            ev.preventDefault();
            cancelNote();
        }
    }

    window.__vttDomDismissNote = function() {
        isLocked = false;
        selectedEl = null;
        if (noteCard) noteCard.style.display = 'none';
        if (overlay) overlay.style.display = 'none';
    };

    window.__vttDomInspectorCleanUp = function() {
        window.__vttDomInspectorActive = false;
        window.__vttDomStickyInspector = false;
        isLocked = false;
        if (overlay) {
            try { overlay.remove(); } catch (e) { overlay.style.display = 'none'; }
        }
        if (noteCard) {
            try { noteCard.remove(); } catch (e) { noteCard.style.display = 'none'; }
        }
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onGlobalKeyDown, true);
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onGlobalKeyDown, true);
})();
";

        private const string DomInspectorStopScript = @"
(function() {
    if (window.__vttDomInspectorCleanUp) {
        window.__vttDomInspectorCleanUp();
    } else {
        window.__vttDomInspectorActive = false;
        window.__vttDomStickyInspector = false;
        var overlay = document.getElementById('__vtt_dom_inspector_overlay');
        if (overlay) overlay.style.display = 'none';
        var noteCard = document.getElementById('__vtt_dom_note_card');
        if (noteCard) noteCard.style.display = 'none';
    }
})();
";

        private const string InspectElementBySelectorScript = @"
(function(selector) {
    try {
        var el = document.querySelector(selector);
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        var outer = el.outerHTML || '';
        if (outer.length > 500) outer = outer.substring(0, 497) + '...';
        var attrs = {};
        for (var i = 0; i < el.attributes.length; i++) {
            attrs[el.attributes[i].name] = el.attributes[i].value;
        }
        return JSON.stringify({
            tag: el.tagName ? el.tagName.toUpperCase() : '',
            id: el.id || '',
            classes: typeof el.className === 'string' ? el.className.trim() : '',
            selector: selector,
            xpath: '',
            outerHtml: outer,
            innerText: (el.innerText || el.textContent || '').trim().substring(0, 200),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            attributes: attrs
        });
    } catch(e) {
        return null;
    }
})('{escapedSelector}');
";

        private const string DomMutationScript = @"
(function() {
    if (window.__vttDomMutationObserver) return;
    window.__vttDomMutations = window.__vttDomMutations || [];

    var styleId = '__vtt_mutation_styles';
    if (!document.getElementById(styleId)) {
        var style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .__vtt_mutated_added {
                outline: 2px solid #22c55e !important;
                outline-offset: 1px !important;
                transition: outline 0.3s ease-out !important;
            }
            .__vtt_mutated_modified {
                outline: 2px solid #f59e0b !important;
                outline-offset: 1px !important;
                transition: outline 0.3s ease-out !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function getSelector(el) {
        if (!el || el.nodeType !== 1) return '';
        if (el.id) return '#' + CSS.escape(el.id);
        var path = [];
        var curr = el;
        while (curr && curr.nodeType === 1 && curr !== document.body && curr !== document.documentElement) {
            var sel = curr.tagName.toLowerCase();
            if (curr.id) {
                path.unshift('#' + CSS.escape(curr.id));
                break;
            }
            if (curr.getAttribute && curr.getAttribute('data-testid')) {
                path.unshift('[data-testid=""' + curr.getAttribute('data-testid') + '""]');
                break;
            }
            var parent = curr.parentNode;
            if (parent && parent.children) {
                var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === curr.tagName; });
                if (siblings.length > 1) {
                    var idx = siblings.indexOf(curr) + 1;
                    sel += ':nth-of-type(' + idx + ')';
                }
            }
            path.unshift(sel);
            curr = parent;
            if (path.length >= 4) break;
        }
        return path.join(' > ');
    }

    function recordMutation(record) {
        window.__vttDomMutations.push(record);
        if (window.__vttDomMutations.length > 200) window.__vttDomMutations.shift();
        if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
            try {
                window.chrome.webview.postMessage(JSON.stringify({
                    type: 'VTT_DOM_MUTATION',
                    data: record
                }));
            } catch(e) {}
        }
    }

    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
            var now = new Date().toISOString();
            if (m.type === 'childList') {
                if (m.addedNodes && m.addedNodes.length > 0) {
                    m.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1 && (!node.id || !node.id.startsWith('__vtt_'))) {
                            node.classList.add('__vtt_mutated_added');
                            recordMutation({
                                type: 'childList',
                                action: 'added',
                                tag: node.tagName ? node.tagName.toUpperCase() : '',
                                selector: getSelector(node),
                                targetDescription: 'Node added to ' + (m.target ? m.target.tagName : ''),
                                timestamp: now
                            });
                        }
                    });
                }
                if (m.removedNodes && m.removedNodes.length > 0) {
                    m.removedNodes.forEach(function(node) {
                        if (node.nodeType === 1 && (!node.id || !node.id.startsWith('__vtt_'))) {
                            recordMutation({
                                type: 'childList',
                                action: 'removed',
                                tag: node.tagName ? node.tagName.toUpperCase() : '',
                                selector: getSelector(m.target),
                                targetDescription: 'Child removed from ' + (m.target ? m.target.tagName : ''),
                                timestamp: now
                            });
                        }
                    });
                }
            } else if (m.type === 'attributes') {
                var target = m.target;
                if (target && target.nodeType === 1 && (!target.id || !target.id.startsWith('__vtt_'))) {
                    if (m.attributeName !== 'class' || !target.classList.contains('__vtt_mutated_modified')) {
                        target.classList.add('__vtt_mutated_modified');
                    }
                    recordMutation({
                        type: 'attributes',
                        action: 'modified',
                        tag: target.tagName ? target.tagName.toUpperCase() : '',
                        selector: getSelector(target),
                        attributeName: m.attributeName || '',
                        oldValue: m.oldValue || '',
                        newValue: target.getAttribute(m.attributeName) || '',
                        targetDescription: 'Attribute ' + m.attributeName + ' modified',
                        timestamp: now
                    });
                }
            } else if (m.type === 'characterData') {
                var parent = m.target.parentElement;
                if (parent && (!parent.id || !parent.id.startsWith('__vtt_'))) {
                    parent.classList.add('__vtt_mutated_modified');
                    recordMutation({
                        type: 'characterData',
                        action: 'modified',
                        tag: parent.tagName ? parent.tagName.toUpperCase() : '',
                        selector: getSelector(parent),
                        oldValue: m.oldValue || '',
                        newValue: m.target.nodeValue || '',
                        targetDescription: 'Text content modified',
                        timestamp: now
                    });
                }
            }
        });
    });

    observer.observe(document.documentElement || document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeOldValue: true,
        characterData: true,
        characterDataOldValue: true
    });

    window.__vttDomMutationObserver = observer;
})();
";

        private const string DomMutationStopScript = @"
(function() {
    if (window.__vttDomMutationObserver) {
        window.__vttDomMutationObserver.disconnect();
        window.__vttDomMutationObserver = null;
    }
    document.querySelectorAll('.__vtt_mutated_added, .__vtt_mutated_modified').forEach(function(el) {
        el.classList.remove('__vtt_mutated_added', '__vtt_mutated_modified');
    });
})();
";

        private const string DomSnapshotScript = @"
(function() {
    window.__vttDomSnapshot = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.id && el.id.startsWith('__vtt_')) continue;
        var text = (el.innerText || el.textContent || '').trim().substring(0, 100);
        window.__vttDomSnapshot.push({
            tag: el.tagName,
            id: el.id || '',
            className: el.className || '',
            textLength: text.length,
            childCount: el.children.length
        });
    }
    return window.__vttDomSnapshot.length;
})();
";

        private const string DomDiffScript = @"
(function() {
    if (!window.__vttDomSnapshot) return JSON.stringify([]);
    var snapshot = window.__vttDomSnapshot;
    var currentAll = Array.from(document.querySelectorAll('*')).filter(function(e) { return !e.id || !e.id.startsWith('__vtt_'); });
    
    var diffs = [];
    if (currentAll.length > snapshot.length) {
        diffs.push({
            type: 'childList',
            action: 'added',
            tag: 'DOM',
            selector: 'document',
            targetDescription: (currentAll.length - snapshot.length) + ' elements added since snapshot',
            timestamp: new Date().toISOString()
        });
    } else if (currentAll.length < snapshot.length) {
        diffs.push({
            type: 'childList',
            action: 'removed',
            tag: 'DOM',
            selector: 'document',
            targetDescription: (snapshot.length - currentAll.length) + ' elements removed since snapshot',
            timestamp: new Date().toISOString()
        });
    }

    return JSON.stringify(diffs);
})();
";

        private const string AccessibilityScannerScript = @"
(function() {
    var violations = [];

    function getSelector(el) {
        if (!el || el.nodeType !== 1) return '';
        if (el.id) return '#' + CSS.escape(el.id);
        var path = [];
        var curr = el;
        while (curr && curr.nodeType === 1 && curr !== document.body && curr !== document.documentElement) {
            var sel = curr.tagName.toLowerCase();
            if (curr.id) {
                path.unshift('#' + CSS.escape(curr.id));
                break;
            }
            if (curr.getAttribute && curr.getAttribute('data-testid')) {
                path.unshift('[data-testid=""' + curr.getAttribute('data-testid') + '""]');
                break;
            }
            var parent = curr.parentNode;
            if (parent && parent.children) {
                var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === curr.tagName; });
                if (siblings.length > 1) {
                    var idx = siblings.indexOf(curr) + 1;
                    sel += ':nth-of-type(' + idx + ')';
                }
            }
            path.unshift(sel);
            curr = parent;
            if (path.length >= 4) break;
        }
        return path.join(' > ');
    }

    function isVisible(el) {
        if (!el) return false;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    // ── 1. MISSING ALT CHECKS ──────────────────────────────────────────────
    var imgs = document.querySelectorAll('img, area[href], input[type=""image""], svg');
    for (var i = 0; i < imgs.length; i++) {
        var el = imgs[i];
        if (!isVisible(el)) continue;
        var tag = el.tagName.toLowerCase();
        var rect = el.getBoundingClientRect();

        if (tag === 'img') {
            if (!el.hasAttribute('alt')) {
                violations.push({
                    category: 'MissingAlt',
                    rule: 'img-missing-alt',
                    severity: 'Error',
                    selector: getSelector(el),
                    tag: 'IMG',
                    message: 'Image is missing an alt attribute.',
                    details: 'Images must have an alt attribute describing their content, or alt="""" if decorative.',
                    snippet: el.outerHTML.substring(0, 200),
                    boundingTop: Math.round(rect.top),
                    boundingLeft: Math.round(rect.left),
                    boundingWidth: Math.round(rect.width),
                    boundingHeight: Math.round(rect.height)
                });
            } else if (el.getAttribute('alt').trim() === '') {
                var parentLink = el.closest('a, button, [role=""button""]');
                if (parentLink && (parentLink.innerText || parentLink.textContent || '').trim() === '') {
                    violations.push({
                        category: 'MissingAlt',
                        rule: 'interactive-img-empty-alt',
                        severity: 'Error',
                        selector: getSelector(el),
                        tag: 'IMG',
                        message: 'Interactive image has empty alt attribute with no surrounding text.',
                        details: 'Images inside interactive links or buttons must have meaningful alt text.',
                        snippet: parentLink.outerHTML.substring(0, 200),
                        boundingTop: Math.round(rect.top),
                        boundingLeft: Math.round(rect.left),
                        boundingWidth: Math.round(rect.width),
                        boundingHeight: Math.round(rect.height)
                    });
                }
            }
        } else if (tag === 'input' && el.type === 'image') {
            if (!el.hasAttribute('alt') || !el.getAttribute('alt').trim()) {
                violations.push({
                    category: 'MissingAlt',
                    rule: 'image-input-missing-alt',
                    severity: 'Error',
                    selector: getSelector(el),
                    tag: 'INPUT',
                    message: 'Image input button is missing alt text.',
                    details: 'Input buttons of type image must have descriptive alt text.',
                    snippet: el.outerHTML.substring(0, 200),
                    boundingTop: Math.round(rect.top),
                    boundingLeft: Math.round(rect.left),
                    boundingWidth: Math.round(rect.width),
                    boundingHeight: Math.round(rect.height)
                });
            }
        } else if (tag === 'area') {
            if (!el.hasAttribute('alt') || !el.getAttribute('alt').trim()) {
                violations.push({
                    category: 'MissingAlt',
                    rule: 'area-missing-alt',
                    severity: 'Error',
                    selector: getSelector(el),
                    tag: 'AREA',
                    message: 'Image map area is missing alt text.',
                    details: 'Active image map areas must have descriptive alt text.',
                    snippet: el.outerHTML.substring(0, 200),
                    boundingTop: Math.round(rect.top),
                    boundingLeft: Math.round(rect.left),
                    boundingWidth: Math.round(rect.width),
                    boundingHeight: Math.round(rect.height)
                });
            }
        } else if (tag === 'svg') {
            if (el.getAttribute('aria-hidden') !== 'true') {
                var parentBtn = el.closest('button, a, [role=""button""]');
                if (parentBtn && (parentBtn.innerText || parentBtn.textContent || '').trim() === '' &&
                    !el.querySelector('title') && !el.getAttribute('aria-label') && !parentBtn.getAttribute('aria-label')) {
                    violations.push({
                        category: 'MissingAlt',
                        rule: 'svg-missing-accessible-name',
                        severity: 'Warning',
                        selector: getSelector(el),
                        tag: 'SVG',
                        message: 'SVG in interactive button/link is missing title or aria-label.',
                        details: 'Standalone SVG icons inside interactive buttons need aria-label or <title>.',
                        snippet: parentBtn.outerHTML.substring(0, 200),
                        boundingTop: Math.round(rect.top),
                        boundingLeft: Math.round(rect.left),
                        boundingWidth: Math.round(rect.width),
                        boundingHeight: Math.round(rect.height)
                    });
                }
            }
        }
    }

    // ── 2. CONTRAST CHECKS (WCAG 2.1 AA) ──────────────────────────────────
    function parseRgb(colorStr) {
        if (!colorStr) return null;
        var m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (m) {
            return {
                r: parseInt(m[1]),
                g: parseInt(m[2]),
                b: parseInt(m[3]),
                a: m[4] !== undefined ? parseFloat(m[4]) : 1.0
            };
        }
        return null;
    }

    function getsRgb(c) {
        c = c / 255.0;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    function getLuminance(rgb) {
        return 0.2126 * getsRgb(rgb.r) + 0.7152 * getsRgb(rgb.g) + 0.0722 * getsRgb(rgb.b);
    }

    function getEffectiveBg(el) {
        var curr = el;
        while (curr && curr !== document.documentElement) {
            var st = window.getComputedStyle(curr);
            var bg = parseRgb(st.backgroundColor);
            if (bg && bg.a > 0.1) return bg;
            curr = curr.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1.0 }; // Default white background
    }

    var textNodes = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, button, label, li, td, th');
    for (var j = 0; j < textNodes.length; j++) {
        var tEl = textNodes[j];
        if (!isVisible(tEl)) continue;
        var hasText = false;
        for (var k = 0; k < tEl.childNodes.length; k++) {
            if (tEl.childNodes[k].nodeType === 3 && tEl.childNodes[k].nodeValue.trim().length > 0) {
                hasText = true; break;
            }
        }
        if (!hasText) continue;

        var cStyle = window.getComputedStyle(tEl);
        var fg = parseRgb(cStyle.color);
        var bg = getEffectiveBg(tEl);

        if (fg && bg) {
            var l1 = getLuminance(fg);
            var l2 = getLuminance(bg);
            var ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

            var fontSize = parseFloat(cStyle.fontSize);
            var isBold = parseInt(cStyle.fontWeight) >= 700 || cStyle.fontWeight === 'bold';
            var isLargeText = fontSize >= 24 || (fontSize >= 18.66 && isBold);
            var requiredRatio = isLargeText ? 3.0 : 4.5;

            if (ratio < requiredRatio) {
                var tRect = tEl.getBoundingClientRect();
                var fgHex = '#' + ((1 << 24) + (fg.r << 16) + (fg.g << 8) + fg.b).toString(16).slice(1);
                var bgHex = '#' + ((1 << 24) + (bg.r << 16) + (bg.g << 8) + bg.b).toString(16).slice(1);

                violations.push({
                    category: 'Contrast',
                    rule: 'color-contrast',
                    severity: ratio < 3.0 ? 'Error' : 'Warning',
                    selector: getSelector(tEl),
                    tag: tEl.tagName,
                    message: 'Low text contrast ratio of ' + ratio.toFixed(2) + ':1 (required ' + requiredRatio + ':1).',
                    details: 'FG: ' + fgHex + ', BG: ' + bgHex + ', Size: ' + Math.round(fontSize) + 'px' + (isBold ? ' bold' : '') + '.',
                    snippet: tEl.outerHTML.substring(0, 160),
                    contrastRatio: Math.round(ratio * 100) / 100,
                    fgColor: fgHex,
                    bgColor: bgHex,
                    boundingTop: Math.round(tRect.top),
                    boundingLeft: Math.round(tRect.left),
                    boundingWidth: Math.round(tRect.width),
                    boundingHeight: Math.round(tRect.height)
                });
            }
        }
    }

    // ── 3. ARIA VIOLATIONS ────────────────────────────────────────────────
    var standardRoles = new Set([
        'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 'checkbox',
        'columnheader', 'combobox', 'complementary', 'contentinfo', 'definition', 'dialog',
        'directory', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group',
        'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'marquee',
        'math', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation',
        'none', 'note', 'option', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region',
        'row', 'rowgroup', 'rowheader', 'scrollbar', 'search', 'searchbox', 'separator', 'slider',
        'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term',
        'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem'
    ]);

    // Role validation
    var roleEls = document.querySelectorAll('[role]');
    for (var r = 0; r < roleEls.length; r++) {
        var rEl = roleEls[r];
        if (!isVisible(rEl)) continue;
        var rRect = rEl.getBoundingClientRect();
        var roleVal = (rEl.getAttribute('role') || '').trim().toLowerCase();
        if (roleVal && !standardRoles.has(roleVal)) {
            violations.push({
                category: 'Aria',
                rule: 'invalid-aria-role',
                severity: 'Error',
                selector: getSelector(rEl),
                tag: rEl.tagName,
                message: 'Invalid ARIA role ""' + roleVal + '"".',
                details: 'Role must be a standard WAI-ARIA role.',
                snippet: rEl.outerHTML.substring(0, 160),
                boundingTop: Math.round(rRect.top),
                boundingLeft: Math.round(rRect.left),
                boundingWidth: Math.round(rRect.width),
                boundingHeight: Math.round(rRect.height)
            });
        }

        // Required ARIA attributes check
        if (roleVal === 'checkbox' || roleVal === 'switch') {
            if (!rEl.hasAttribute('aria-checked')) {
                violations.push({
                    category: 'Aria',
                    rule: 'missing-aria-checked',
                    severity: 'Error',
                    selector: getSelector(rEl),
                    tag: rEl.tagName,
                    message: 'Element with role=""' + roleVal + '"" is missing aria-checked attribute.',
                    details: 'Checkboxes and switches require aria-checked=""true|false|mixed"".',
                    snippet: rEl.outerHTML.substring(0, 160),
                    boundingTop: Math.round(rRect.top),
                    boundingLeft: Math.round(rRect.left),
                    boundingWidth: Math.round(rRect.width),
                    boundingHeight: Math.round(rRect.height)
                });
            }
        } else if (roleVal === 'combobox') {
            if (!rEl.hasAttribute('aria-expanded')) {
                violations.push({
                    category: 'Aria',
                    rule: 'missing-aria-expanded',
                    severity: 'Error',
                    selector: getSelector(rEl),
                    tag: rEl.tagName,
                    message: 'Element with role=""combobox"" is missing aria-expanded attribute.',
                    details: 'Comboboxes must communicate expanded/collapsed state via aria-expanded.',
                    snippet: rEl.outerHTML.substring(0, 160),
                    boundingTop: Math.round(rRect.top),
                    boundingLeft: Math.round(rRect.left),
                    boundingWidth: Math.round(rRect.width),
                    boundingHeight: Math.round(rRect.height)
                });
            }
        }
    }

    // Interactive elements missing accessible name
    var interactive = document.querySelectorAll('button, a[href], input:not([type=""hidden""]), select, textarea, [role=""button""]');
    for (var m = 0; m < interactive.length; m++) {
        var intEl = interactive[m];
        if (!isVisible(intEl)) continue;
        var text = (intEl.innerText || intEl.textContent || intEl.value || '').trim();
        var label = intEl.getAttribute('aria-label') || '';
        var labelledBy = intEl.getAttribute('aria-labelledby') || '';
        var title = intEl.getAttribute('title') || '';
        var hasImgAlt = !!intEl.querySelector('img[alt]:not([alt=""""])');

        if (!text && !label && !labelledBy && !title && !hasImgAlt) {
            var iRect = intEl.getBoundingClientRect();
            violations.push({
                category: 'Aria',
                rule: 'interactive-missing-name',
                severity: 'Error',
                selector: getSelector(intEl),
                tag: intEl.tagName,
                message: 'Interactive <' + intEl.tagName.toLowerCase() + '> has no accessible name.',
                details: 'Interactive controls must have visible text, aria-label, aria-labelledby, or title.',
                snippet: intEl.outerHTML.substring(0, 160),
                boundingTop: Math.round(iRect.top),
                boundingLeft: Math.round(iRect.left),
                boundingWidth: Math.round(iRect.width),
                boundingHeight: Math.round(iRect.height)
            });
        }
    }

    // Broken ID references
    var refEls = document.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls]');
    for (var b = 0; b < refEls.length; b++) {
        var refEl = refEls[b];
        ['aria-labelledby', 'aria-describedby', 'aria-controls'].forEach(function(attr) {
            if (refEl.hasAttribute(attr)) {
                var ids = (refEl.getAttribute(attr) || '').trim().split(/\s+/);
                ids.forEach(function(id) {
                    if (id && !document.getElementById(id)) {
                        var bRect = refEl.getBoundingClientRect();
                        violations.push({
                            category: 'Aria',
                            rule: 'broken-aria-reference',
                            severity: 'Error',
                            selector: getSelector(refEl),
                            tag: refEl.tagName,
                            message: 'Attribute ' + attr + ' references non-existent ID ""' + id + '"".',
                            details: 'ARIA ID references must correspond to existing elements in the document.',
                            snippet: refEl.outerHTML.substring(0, 160),
                            boundingTop: Math.round(bRect.top),
                            boundingLeft: Math.round(bRect.left),
                            boundingWidth: Math.round(bRect.width),
                            boundingHeight: Math.round(bRect.height)
                        });
                    }
                });
            }
        });
    }

    // ── Inject in-page badges ─────────────────────────────────────────────
    document.querySelectorAll('.__vtt_a11y_badge').forEach(function(b) { b.remove(); });
    violations.forEach(function(v, idx) {
        var badge = document.createElement('div');
        badge.className = '__vtt_a11y_badge';
        badge.style.position = 'fixed';
        badge.style.zIndex = '2147483646';
        badge.style.top = Math.max(0, v.boundingTop - 12) + 'px';
        badge.style.left = Math.max(0, v.boundingLeft + v.boundingWidth - 28) + 'px';
        badge.style.padding = '2px 5px';
        badge.style.borderRadius = '3px';
        badge.style.fontFamily = 'Consolas, monospace';
        badge.style.fontSize = '9px';
        badge.style.fontWeight = 'bold';
        badge.style.color = '#ffffff';
        badge.style.cursor = 'pointer';
        badge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.5)';
        badge.title = v.rule + ': ' + v.message;

        if (v.category === 'MissingAlt') {
            badge.style.backgroundColor = '#f97316'; // Orange
            badge.innerText = 'ALT?';
        } else if (v.category === 'Contrast') {
            badge.style.backgroundColor = '#ef4444'; // Red
            badge.innerText = v.contrastRatio ? v.contrastRatio + ':1' : 'CONTRAST';
        } else {
            badge.style.backgroundColor = '#a855f7'; // Purple
            badge.innerText = 'ARIA!';
        }

        badge.onclick = function(e) {
            e.stopPropagation();
            if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
                window.chrome.webview.postMessage(JSON.stringify({
                    type: 'VTT_A11Y_CLICK',
                    data: v
                }));
            }
        };

        document.documentElement.appendChild(badge);
    });

    return JSON.stringify({
        url: window.location.href,
        timestamp: new Date().toISOString(),
        violations: violations
    });
})();
";

        private const string ToggleA11yBadgesScript = @"
(function(visible) {
    var badges = document.querySelectorAll('.__vtt_a11y_badge');
    badges.forEach(function(b) {
        b.style.display = visible ? 'block' : 'none';
    });
})({visible});
";

        private const string ClearA11yBadgesScript = @"
(function() {
    var badges = document.querySelectorAll('.__vtt_a11y_badge');
    badges.forEach(function(b) { b.remove(); });
})();
";

        private const string ScrollToAndHighlightScript = @"
(function(selector) {
    try {
        var el = document.querySelector(selector);
        if (!el) return false;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var origOutline = el.style.outline;
        el.style.outline = '3px solid #38bdf8';
        setTimeout(function() { el.style.outline = origOutline; }, 2500);
        return true;
    } catch(e) {
        return false;
    }
})('{escapedSelector}');
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

        private sealed class CdpInFlightRequest
        {
            public string RequestId { get; set; } = "";
            public string Url { get; set; } = "";
            public string Method { get; set; } = "GET";
            public double Timestamp { get; set; }
            public double WallTime { get; set; }
        }

        // ── CDP Telemetry Buffers & Synchronization ──────────────────────────────
        private static readonly object _cdpLock = new();
        private static readonly List<ConsoleLogItem> _cdpConsoleLogs = new();
        private static readonly List<NetworkFailureItem> _cdpNetworkLogs = new();
        private static readonly ConcurrentDictionary<string, CdpInFlightRequest> _inFlightRequests = new();
        private static int _cdpScriptErrors = 0;
        private static readonly HashSet<CoreWebView2> _attachedCoreWebViews = new();

        /// <summary>Event raised when an element is inspected in the active WebView2.</summary>
        public static event Action<DomElementInfo>? OnDomElementInspected;

        /// <summary>Event raised when a DOM mutation is observed in the active page.</summary>
        public static event Action<DomMutationRecord>? OnDomMutationRecorded;

        /// <summary>Event raised when an in-page accessibility violation badge is clicked.</summary>
        public static event Action<AccessibilityViolation>? OnA11yViolationClicked;

        /// <summary>
        /// Attaches Chrome DevTools Protocol (CDP) domains, listeners, and guaranteed early JS injection
        /// to the specified CoreWebView2 instance. Safe to call repeatedly (idempotent).
        /// </summary>
        public static async Task AttachCdpAsync(CoreWebView2? coreWebView2)
        {
            if (coreWebView2 == null) return;

            lock (_cdpLock)
            {
                if (_attachedCoreWebViews.Contains(coreWebView2))
                    return;
                _attachedCoreWebViews.Add(coreWebView2);
            }

            try
            {
                // 1. Enable CDP Domains
                await coreWebView2.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}");
                await coreWebView2.CallDevToolsProtocolMethodAsync("Console.enable", "{}");
                await coreWebView2.CallDevToolsProtocolMethodAsync("Network.enable", "{}");
                await coreWebView2.CallDevToolsProtocolMethodAsync("DOM.enable", "{}");

                // 2. Wire Console and Runtime Exception Receivers
                var runtimeConsoleReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled");
                runtimeConsoleReceiver.DevToolsProtocolEventReceived += OnCdpConsoleApiCalled;

                var consoleMessageReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Console.messageAdded");
                consoleMessageReceiver.DevToolsProtocolEventReceived += OnCdpConsoleMessageAdded;

                var runtimeExceptionReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown");
                runtimeExceptionReceiver.DevToolsProtocolEventReceived += OnCdpExceptionThrown;

                // 3. Wire Network Receivers
                var reqSentReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Network.requestWillBeSent");
                reqSentReceiver.DevToolsProtocolEventReceived += OnCdpRequestWillBeSent;

                var respRecvReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Network.responseReceived");
                respRecvReceiver.DevToolsProtocolEventReceived += OnCdpResponseReceived;

                var loadFailReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Network.loadingFailed");
                loadFailReceiver.DevToolsProtocolEventReceived += OnCdpLoadingFailed;

                var loadFinReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Network.loadingFinished");
                loadFinReceiver.DevToolsProtocolEventReceived += OnCdpLoadingFinished;

                // 4. Guaranteed Early JS Injection for Repro Tracking
                await coreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(ObserverScript);

                // Also inject into current document immediately if already loaded
                await coreWebView2.ExecuteScriptAsync(ObserverScript);

                ActivityLog.Log(VisualTestTrackerStore.Channel, "DevTools Protocol (CDP) attached and initialized successfully.");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"DevTools Protocol attachment failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Unhooks Chrome DevTools Protocol (CDP) listeners from the specified CoreWebView2 instance,
        /// releasing event handlers and freeing the reference.
        /// </summary>
        public static void DetachCdp(CoreWebView2? coreWebView2)
        {
            if (coreWebView2 == null) return;

            lock (_cdpLock)
            {
                if (!_attachedCoreWebViews.Contains(coreWebView2))
                    return;
                _attachedCoreWebViews.Remove(coreWebView2);
            }

            try
            {
                var runtimeConsoleReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Runtime.consoleAPICalled");
                runtimeConsoleReceiver.DevToolsProtocolEventReceived -= OnCdpConsoleApiCalled;

                var consoleMessageReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Console.messageAdded");
                consoleMessageReceiver.DevToolsProtocolEventReceived -= OnCdpConsoleMessageAdded;

                var runtimeExceptionReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown");
                runtimeExceptionReceiver.DevToolsProtocolEventReceived -= OnCdpExceptionThrown;

                var reqSentReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Network.requestWillBeSent");
                reqSentReceiver.DevToolsProtocolEventReceived -= OnCdpRequestWillBeSent;

                var respRecvReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Network.responseReceived");
                respRecvReceiver.DevToolsProtocolEventReceived -= OnCdpResponseReceived;

                var loadFailReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Network.loadingFailed");
                loadFailReceiver.DevToolsProtocolEventReceived -= OnCdpLoadingFailed;

                var loadFinReceiver = coreWebView2.GetDevToolsProtocolEventReceiver("Network.loadingFinished");
                loadFinReceiver.DevToolsProtocolEventReceived -= OnCdpLoadingFinished;

                ActivityLog.Log(VisualTestTrackerStore.Channel, "DevTools Protocol (CDP) detached successfully.");
            }
            catch { }
        }

        // ── CDP Event Handlers ──────────────────────────────────────────────────

        private static void OnCdpConsoleApiCalled(object? sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e)
        {
            try
            {
                using var doc = JsonDocument.Parse(e.ParameterObjectAsJson);
                var root = doc.RootElement;
                string type = root.TryGetProperty("type", out var typeEl) ? typeEl.GetString() ?? "log" : "log";
                string level = type.ToLowerInvariant() switch
                {
                    "error" => "error",
                    "warning" => "warn",
                    "info" => "info",
                    "debug" => "debug",
                    _ => "log"
                };

                var argsSb = new StringBuilder();
                if (root.TryGetProperty("args", out var argsEl) && argsEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var arg in argsEl.EnumerateArray())
                    {
                        if (argsSb.Length > 0) argsSb.Append(' ');
                        if (arg.TryGetProperty("value", out var valEl))
                        {
                            argsSb.Append(valEl.ToString());
                        }
                        else if (arg.TryGetProperty("description", out var descEl))
                        {
                            argsSb.Append(descEl.GetString());
                        }
                        else
                        {
                            argsSb.Append(arg.ToString());
                        }
                    }
                }

                string stack = "";
                if (root.TryGetProperty("stackTrace", out var stackEl) &&
                    stackEl.TryGetProperty("callFrames", out var framesEl) &&
                    framesEl.ValueKind == JsonValueKind.Array)
                {
                    var stackSb = new StringBuilder();
                    foreach (var f in framesEl.EnumerateArray())
                    {
                        string fn = f.TryGetProperty("functionName", out var fnEl) ? fnEl.GetString() ?? "" : "";
                        string url = f.TryGetProperty("url", out var urlEl) ? urlEl.GetString() ?? "" : "";
                        int line = f.TryGetProperty("lineNumber", out var lineEl) ? lineEl.GetInt32() : 0;
                        int col = f.TryGetProperty("columnNumber", out var colEl) ? colEl.GetInt32() : 0;
                        stackSb.AppendLine($"{fn} ({url}:{line}:{col})");
                    }
                    stack = stackSb.ToString().TrimEnd();
                }

                string timestamp = DateTime.Now.ToString("HH:mm:ss.fff");

                lock (_cdpLock)
                {
                    _cdpConsoleLogs.Add(new ConsoleLogItem
                    {
                        Level = level,
                        Message = argsSb.ToString(),
                        StackTrace = stack,
                        Timestamp = timestamp
                    });
                    if (_cdpConsoleLogs.Count > 100) _cdpConsoleLogs.RemoveAt(0);
                }
            }
            catch { }
        }

        private static void OnCdpConsoleMessageAdded(object? sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e)
        {
            try
            {
                using var doc = JsonDocument.Parse(e.ParameterObjectAsJson);
                if (doc.RootElement.TryGetProperty("message", out var msgEl))
                {
                    string level = msgEl.TryGetProperty("level", out var lvlEl) ? lvlEl.GetString() ?? "log" : "log";
                    string text = msgEl.TryGetProperty("text", out var textEl) ? textEl.GetString() ?? "" : "";
                    string url = msgEl.TryGetProperty("url", out var urlEl) ? urlEl.GetString() ?? "" : "";
                    int line = msgEl.TryGetProperty("line", out var lineEl) ? lineEl.GetInt32() : 0;
                    string loc = !string.IsNullOrEmpty(url) ? $" ({url}:{line})" : "";

                    string timestamp = DateTime.Now.ToString("HH:mm:ss.fff");
                    string fullMsg = text + loc;

                    lock (_cdpLock)
                    {
                        if (_cdpConsoleLogs.Count == 0 || !_cdpConsoleLogs[^1].Message.Equals(fullMsg, StringComparison.Ordinal))
                        {
                            _cdpConsoleLogs.Add(new ConsoleLogItem
                            {
                                Level = level.ToLowerInvariant() == "warning" ? "warn" : level.ToLowerInvariant(),
                                Message = fullMsg,
                                StackTrace = "",
                                Timestamp = timestamp
                            });
                            if (_cdpConsoleLogs.Count > 100) _cdpConsoleLogs.RemoveAt(0);
                        }
                    }
                }
            }
            catch { }
        }

        private static void OnCdpExceptionThrown(object? sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e)
        {
            try
            {
                using var doc = JsonDocument.Parse(e.ParameterObjectAsJson);
                if (doc.RootElement.TryGetProperty("exceptionDetails", out var detEl))
                {
                    string text = detEl.TryGetProperty("text", out var tEl) ? tEl.GetString() ?? "Uncaught Exception" : "Uncaught Exception";
                    string desc = "";
                    if (detEl.TryGetProperty("exception", out var exObj) && exObj.TryGetProperty("description", out var descEl))
                    {
                        desc = descEl.GetString() ?? "";
                    }

                    string url = detEl.TryGetProperty("url", out var urlEl) ? urlEl.GetString() ?? "" : "";
                    int line = detEl.TryGetProperty("lineNumber", out var lineEl) ? lineEl.GetInt32() : 0;
                    int col = detEl.TryGetProperty("columnNumber", out var colEl) ? colEl.GetInt32() : 0;
                    string loc = !string.IsNullOrEmpty(url) ? $" ({url}:{line}:{col})" : "";

                    string stack = "";
                    if (detEl.TryGetProperty("stackTrace", out var stackEl) &&
                        stackEl.TryGetProperty("callFrames", out var framesEl) &&
                        framesEl.ValueKind == JsonValueKind.Array)
                    {
                        var stackSb = new StringBuilder();
                        foreach (var f in framesEl.EnumerateArray())
                        {
                            string fn = f.TryGetProperty("functionName", out var fnEl) ? fnEl.GetString() ?? "" : "";
                            string fUrl = f.TryGetProperty("url", out var uEl) ? uEl.GetString() ?? "" : "";
                            int fLine = f.TryGetProperty("lineNumber", out var lEl) ? lEl.GetInt32() : 0;
                            int fCol = f.TryGetProperty("columnNumber", out var cEl) ? cEl.GetInt32() : 0;
                            stackSb.AppendLine($"{fn} ({fUrl}:{fLine}:{fCol})");
                        }
                        stack = stackSb.ToString().TrimEnd();
                    }

                    string fullMsg = (!string.IsNullOrEmpty(desc) ? desc : text) + loc;
                    string timestamp = DateTime.Now.ToString("HH:mm:ss.fff");

                    lock (_cdpLock)
                    {
                        _cdpScriptErrors++;
                        _cdpConsoleLogs.Add(new ConsoleLogItem
                        {
                            Level = "exception",
                            Message = fullMsg,
                            StackTrace = stack,
                            Timestamp = timestamp
                        });
                        if (_cdpConsoleLogs.Count > 100) _cdpConsoleLogs.RemoveAt(0);
                    }
                }
            }
            catch { }
        }

        private static void OnCdpRequestWillBeSent(object? sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e)
        {
            try
            {
                using var doc = JsonDocument.Parse(e.ParameterObjectAsJson);
                var root = doc.RootElement;
                string reqId = root.TryGetProperty("requestId", out var rEl) ? rEl.GetString() ?? "" : "";
                if (string.IsNullOrEmpty(reqId)) return;

                string url = "";
                string method = "GET";
                if (root.TryGetProperty("request", out var reqEl))
                {
                    url = reqEl.TryGetProperty("url", out var uEl) ? uEl.GetString() ?? "" : "";
                    method = reqEl.TryGetProperty("method", out var mEl) ? mEl.GetString() ?? "GET" : "GET";
                }

                double ts = root.TryGetProperty("timestamp", out var tsEl) ? tsEl.GetDouble() : 0;
                double wall = root.TryGetProperty("wallTime", out var wEl) ? wEl.GetDouble() : 0;

                _inFlightRequests[reqId] = new CdpInFlightRequest
                {
                    RequestId = reqId,
                    Url = url,
                    Method = method,
                    Timestamp = ts,
                    WallTime = wall
                };
            }
            catch { }
        }

        private static void OnCdpResponseReceived(object? sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e)
        {
            try
            {
                using var doc = JsonDocument.Parse(e.ParameterObjectAsJson);
                var root = doc.RootElement;
                string reqId = root.TryGetProperty("requestId", out var rEl) ? rEl.GetString() ?? "" : "";
                double ts = root.TryGetProperty("timestamp", out var tsEl) ? tsEl.GetDouble() : 0;

                string url = "";
                int status = 0;
                string statusText = "";
                string payloadSize = "";

                if (root.TryGetProperty("response", out var respEl))
                {
                    url = respEl.TryGetProperty("url", out var uEl) ? uEl.GetString() ?? "" : "";
                    status = respEl.TryGetProperty("status", out var sEl) ? sEl.GetInt32() : 0;
                    statusText = respEl.TryGetProperty("statusText", out var stEl) ? stEl.GetString() ?? "" : "";

                    if (respEl.TryGetProperty("headers", out var headersEl))
                    {
                        foreach (var h in headersEl.EnumerateObject())
                        {
                            if (h.Name.Equals("content-length", StringComparison.OrdinalIgnoreCase))
                            {
                                if (long.TryParse(h.Value.GetString(), out long bytes))
                                {
                                    payloadSize = FormatBytes(bytes);
                                }
                                break;
                            }
                        }
                    }

                    if (string.IsNullOrEmpty(payloadSize) && respEl.TryGetProperty("encodedDataLength", out var lenEl))
                    {
                        payloadSize = FormatBytes((long)lenEl.GetDouble());
                    }
                }

                double durationMs = 0;
                string method = "GET";
                if (!string.IsNullOrEmpty(reqId) && _inFlightRequests.TryGetValue(reqId, out var req))
                {
                    if (ts > 0 && req.Timestamp > 0)
                        durationMs = Math.Round(Math.Max(0, (ts - req.Timestamp) * 1000));
                    method = req.Method;
                    if (string.IsNullOrEmpty(url)) url = req.Url;
                }

                bool isFailed = status >= 400 || status == 0;
                string timestamp = DateTime.Now.ToString("HH:mm:ss.fff");

                lock (_cdpLock)
                {
                    _cdpNetworkLogs.Add(new NetworkFailureItem
                    {
                        Method = method,
                        Url = url,
                        Status = status,
                        StatusText = !string.IsNullOrEmpty(statusText) ? statusText : (isFailed ? "HTTP Error" : "OK"),
                        DurationMs = durationMs,
                        PayloadSize = payloadSize,
                        Timestamp = timestamp,
                        Failed = isFailed
                    });
                    if (_cdpNetworkLogs.Count > 100) _cdpNetworkLogs.RemoveAt(0);
                }
            }
            catch { }
        }

        private static void OnCdpLoadingFailed(object? sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e)
        {
            try
            {
                using var doc = JsonDocument.Parse(e.ParameterObjectAsJson);
                var root = doc.RootElement;
                string reqId = root.TryGetProperty("requestId", out var rEl) ? rEl.GetString() ?? "" : "";
                string errorText = root.TryGetProperty("errorText", out var errEl) ? errEl.GetString() ?? "Network Drop" : "Network Drop";
                bool canceled = root.TryGetProperty("canceled", out var canEl) && canEl.GetBoolean();
                double ts = root.TryGetProperty("timestamp", out var tsEl) ? tsEl.GetDouble() : 0;

                string url = "";
                string method = "GET";
                double durationMs = 0;

                if (!string.IsNullOrEmpty(reqId) && _inFlightRequests.TryRemove(reqId, out var req))
                {
                    url = req.Url;
                    method = req.Method;
                    if (ts > 0 && req.Timestamp > 0)
                        durationMs = Math.Round(Math.Max(0, (ts - req.Timestamp) * 1000));
                }

                string timestamp = DateTime.Now.ToString("HH:mm:ss.fff");

                lock (_cdpLock)
                {
                    _cdpNetworkLogs.Add(new NetworkFailureItem
                    {
                        Method = method,
                        Url = url,
                        Status = 0,
                        StatusText = canceled ? "Canceled" : errorText,
                        DurationMs = durationMs,
                        PayloadSize = "",
                        Timestamp = timestamp,
                        Failed = true
                    });
                    if (_cdpNetworkLogs.Count > 100) _cdpNetworkLogs.RemoveAt(0);
                }
            }
            catch { }
        }

        private static void OnCdpLoadingFinished(object? sender, CoreWebView2DevToolsProtocolEventReceivedEventArgs e)
        {
            try
            {
                using var doc = JsonDocument.Parse(e.ParameterObjectAsJson);
                var root = doc.RootElement;
                string reqId = root.TryGetProperty("requestId", out var rEl) ? rEl.GetString() ?? "" : "";
                if (!string.IsNullOrEmpty(reqId))
                {
                    _inFlightRequests.TryRemove(reqId, out _);
                }
            }
            catch { }
        }

        private static string FormatBytes(long bytes)
        {
            if (bytes <= 0) return "";
            if (bytes < 1024) return $"{bytes} B";
            if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F1} KB";
            return $"{bytes / (1024.0 * 1024.0):F2} MB";
        }

        /// <summary>Clears CDP captured console logs, network logs, and error metrics.</summary>
        public static void ClearCdpData()
        {
            lock (_cdpLock)
            {
                _cdpConsoleLogs.Clear();
                _cdpNetworkLogs.Clear();
                _inFlightRequests.Clear();
                _cdpScriptErrors = 0;
            }
        }

        // ── DOM Inspection API ──────────────────────────────────────────────────

        /// <summary>Enables the interactive hover and click DOM element inspector in WebView2.</summary>
        public static async Task EnableDomInspectorAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return;
            try
            {
                await webView.ExecuteScriptAsync(DomInspectorScript);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"EnableDomInspector error: {ex.Message}");
            }
        }

        /// <summary>Disables the DOM element inspector overlay in WebView2.</summary>
        public static async Task DisableDomInspectorAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return;
            try
            {
                await webView.ExecuteScriptAsync(DomInspectorStopScript);
            }
            catch { }
        }

        /// <summary>Inspects an element matching a CSS selector and returns its structured metadata.</summary>
        public static async Task<DomElementInfo?> InspectElementBySelectorAsync(WebView2? webView, string selector)
        {
            if (webView?.CoreWebView2 == null || string.IsNullOrWhiteSpace(selector)) return null;
            try
            {
                string escapedSelector = selector.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\"", "\\\"");
                string script = InspectElementBySelectorScript.Replace("{escapedSelector}", escapedSelector);
                var rawResult = await webView.ExecuteScriptAsync(script);
                if (string.IsNullOrWhiteSpace(rawResult) || rawResult == "null") return null;

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

                return JsonSerializer.Deserialize<DomElementInfo>(jsonToParse, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"InspectElementBySelector error: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// Parses an incoming WebMessage string to check if it contains a VTT_DOM_INSPECT payload.
        /// Raises OnDomElementInspected if valid.
        /// </summary>
        public static DomElementInfo? TryParseDomInspectMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message) || !message.Contains("VTT_DOM_INSPECT")) return null;
            try
            {
                using var doc = JsonDocument.Parse(message);
                if (doc.RootElement.TryGetProperty("type", out var typeEl) &&
                    typeEl.GetString() == "VTT_DOM_INSPECT" &&
                    doc.RootElement.TryGetProperty("data", out var dataEl))
                {
                    var info = JsonSerializer.Deserialize<DomElementInfo>(dataEl.GetRawText(), new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    if (info != null)
                    {
                        OnDomElementInspected?.Invoke(info);
                        return info;
                    }
                }
            }
            catch { }
            return null;
        }

        /// <summary>Dismisses the in-page floating note card and releases element lock, keeping sticky inspector active if enabled.</summary>
        public static async Task DismissDomNoteAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return;
            try
            {
                await webView.ExecuteScriptAsync("window.__vttDomDismissNote && window.__vttDomDismissNote();");
            }
            catch { }
        }

        /// <summary>
        /// Parses an incoming WebMessage string to check if it contains a VTT_DOM_BUG_SUBMIT payload.
        /// </summary>
        public static (string Comment, DomElementInfo Element)? TryParseDomBugSubmitMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message) || !message.Contains("VTT_DOM_BUG_SUBMIT")) return null;
            try
            {
                using var doc = JsonDocument.Parse(message);
                if (doc.RootElement.TryGetProperty("type", out var typeEl) &&
                    typeEl.GetString() == "VTT_DOM_BUG_SUBMIT" &&
                    doc.RootElement.TryGetProperty("data", out var dataEl))
                {
                    string comment = dataEl.TryGetProperty("comment", out var cEl) ? cEl.GetString() ?? "" : "";
                    DomElementInfo? element = null;
                    if (dataEl.TryGetProperty("element", out var elEl))
                    {
                        element = JsonSerializer.Deserialize<DomElementInfo>(elEl.GetRawText(), new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        });
                    }
                    if (element != null) return (comment, element);
                }
            }
            catch { }
            return null;
        }

        /// <summary>
        /// Parses an incoming WebMessage string to check if it contains a VTT_DOM_ADD_STEP payload.
        /// </summary>
        public static string? TryParseDomAddStepMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message) || !message.Contains("VTT_DOM_ADD_STEP")) return null;
            try
            {
                using var doc = JsonDocument.Parse(message);
                if (doc.RootElement.TryGetProperty("type", out var typeEl) &&
                    typeEl.GetString() == "VTT_DOM_ADD_STEP" &&
                    doc.RootElement.TryGetProperty("data", out var dataEl))
                {
                    return dataEl.TryGetProperty("step", out var sEl) ? sEl.GetString() : null;
                }
            }
            catch { }
            return null;
        }

        /// <summary>
        /// Parses an incoming WebMessage string to check if it contains a VTT_DOM_INSPECT_CANCEL payload.
        /// </summary>
        public static bool TryParseDomInspectCancelMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message) || !message.Contains("VTT_DOM_INSPECT_CANCEL")) return false;
            try
            {
                using var doc = JsonDocument.Parse(message);
                return doc.RootElement.TryGetProperty("type", out var typeEl) && typeEl.GetString() == "VTT_DOM_INSPECT_CANCEL";
            }
            catch { }
            return false;
        }

        /// <summary>
        /// Parses an incoming WebMessage string to check if it contains a VTT_DOM_MUTATION payload.
        /// Raises OnDomMutationRecorded if valid.
        /// </summary>
        public static DomMutationRecord? TryParseDomMutationMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message) || !message.Contains("VTT_DOM_MUTATION")) return null;
            try
            {
                using var doc = JsonDocument.Parse(message);
                if (doc.RootElement.TryGetProperty("type", out var typeEl) &&
                    typeEl.GetString() == "VTT_DOM_MUTATION" &&
                    doc.RootElement.TryGetProperty("data", out var dataEl))
                {
                    var record = JsonSerializer.Deserialize<DomMutationRecord>(dataEl.GetRawText(), new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    if (record != null)
                    {
                        OnDomMutationRecorded?.Invoke(record);
                        return record;
                    }
                }
            }
            catch { }
            return null;
        }

        /// <summary>
        /// Parses an incoming WebMessage string to check if it contains a VTT_A11Y_CLICK payload.
        /// Raises OnA11yViolationClicked if valid.
        /// </summary>
        public static AccessibilityViolation? TryParseA11yClickMessage(string message)
        {
            if (string.IsNullOrWhiteSpace(message) || !message.Contains("VTT_A11Y_CLICK")) return null;
            try
            {
                using var doc = JsonDocument.Parse(message);
                if (doc.RootElement.TryGetProperty("type", out var typeEl) &&
                    typeEl.GetString() == "VTT_A11Y_CLICK" &&
                    doc.RootElement.TryGetProperty("data", out var dataEl))
                {
                    var violation = JsonSerializer.Deserialize<AccessibilityViolation>(dataEl.GetRawText(), new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    if (violation != null)
                    {
                        OnA11yViolationClicked?.Invoke(violation);
                        return violation;
                    }
                }
            }
            catch { }
            return null;
        }

        // ── DOM Mutation Tracking & Snapshot API ────────────────────────────────

        /// <summary>Enables real-time in-page DOM mutation tracking with visual highlight outlines.</summary>
        public static async Task EnableDomMutationObserverAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return;
            try
            {
                await webView.ExecuteScriptAsync(DomMutationScript);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"EnableDomMutationObserver error: {ex.Message}");
            }
        }

        /// <summary>Disables in-page DOM mutation tracking and removes outline classes.</summary>
        public static async Task DisableDomMutationObserverAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return;
            try
            {
                await webView.ExecuteScriptAsync(DomMutationStopScript);
            }
            catch { }
        }

        /// <summary>Takes an in-memory snapshot of the current DOM structure for diffing.</summary>
        public static async Task<int> TakeDomSnapshotAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return 0;
            try
            {
                var raw = await webView.ExecuteScriptAsync(DomSnapshotScript);
                if (int.TryParse(raw, out int count)) return count;
            }
            catch { }
            return 0;
        }

        /// <summary>Diffs the current live DOM against the previous in-memory snapshot.</summary>
        public static async Task<List<DomMutationRecord>> DiffDomSnapshotAsync(WebView2? webView)
        {
            var list = new List<DomMutationRecord>();
            if (webView?.CoreWebView2 == null) return list;
            try
            {
                var raw = await webView.ExecuteScriptAsync(DomDiffScript);
                if (!string.IsNullOrWhiteSpace(raw) && raw != "null")
                {
                    string json = raw;
                    if (raw.StartsWith("\"") && raw.EndsWith("\""))
                    {
                        try { json = JsonSerializer.Deserialize<string>(raw) ?? raw; } catch { }
                    }
                    var items = JsonSerializer.Deserialize<List<DomMutationRecord>>(json, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    if (items != null) list = items;
                }
            }
            catch { }
            return list;
        }

        // ── Accessibility Audit API ─────────────────────────────────────────────

        /// <summary>Runs an automated WCAG 2.1 AA accessibility audit across missing alt, contrast, and ARIA rules.</summary>
        public static async Task<AccessibilityAuditReport> RunAccessibilityAuditAsync(WebView2? webView)
        {
            var report = new AccessibilityAuditReport();
            if (webView?.CoreWebView2 == null) return report;
            try
            {
                var raw = await webView.ExecuteScriptAsync(AccessibilityScannerScript);
                if (!string.IsNullOrWhiteSpace(raw) && raw != "null")
                {
                    string json = raw;
                    if (raw.StartsWith("\"") && raw.EndsWith("\""))
                    {
                        try { json = JsonSerializer.Deserialize<string>(raw) ?? raw; } catch { }
                    }

                    var parsed = JsonSerializer.Deserialize<AccessibilityAuditReport>(json, new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    });
                    if (parsed != null) report = parsed;
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(VisualTestTrackerStore.Channel, $"Accessibility audit error: {ex.Message}");
            }
            return report;
        }

        /// <summary>Toggles visibility of on-page accessibility violation badge markers.</summary>
        public static async Task ToggleA11yBadgesAsync(WebView2? webView, bool visible)
        {
            if (webView?.CoreWebView2 == null) return;
            try
            {
                string script = ToggleA11yBadgesScript.Replace("{visible}", visible ? "true" : "false");
                await webView.ExecuteScriptAsync(script);
            }
            catch { }
        }

        /// <summary>Removes all in-page accessibility violation badges from the DOM.</summary>
        public static async Task ClearA11yBadgesAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return;
            try
            {
                await webView.ExecuteScriptAsync(ClearA11yBadgesScript);
            }
            catch { }
        }

        /// <summary>Scrolls the WebView2 viewport to an element and flashes a prominent highlight border.</summary>
        public static async Task<bool> ScrollToAndHighlightElementAsync(WebView2? webView, string selector)
        {
            if (webView?.CoreWebView2 == null || string.IsNullOrWhiteSpace(selector)) return false;
            try
            {
                string escaped = selector.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\"", "\\\"");
                string script = ScrollToAndHighlightScript.Replace("{escapedSelector}", escaped);
                var raw = await webView.ExecuteScriptAsync(script);
                return raw == "true";
            }
            catch
            {
                return false;
            }
        }

        /// <summary>Injects the observer script into the active WebView2 page and attaches CDP.</summary>
        public static async Task InjectObserverAsync(WebView2? webView)
        {
            if (webView?.CoreWebView2 == null) return;
            try
            {
                await AttachCdpAsync(webView.CoreWebView2);
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
            var snapshot = new TelemetrySnapshot();

            if (webView?.CoreWebView2 != null)
            {
                try
                {
                    var rawResult = await webView.ExecuteScriptAsync(CollectorScript);
                    if (!string.IsNullOrWhiteSpace(rawResult) && rawResult != "null")
                    {
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

                        var parsed = JsonSerializer.Deserialize<TelemetrySnapshot>(jsonToParse, new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        });
                        if (parsed != null) snapshot = parsed;
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(VisualTestTrackerStore.Channel, $"Telemetry collection error: {ex.Message}");
                }
            }

            // Merge CDP captured data for maximum fidelity (catches pre-injection logs, uncaught exceptions, network drops)
            lock (_cdpLock)
            {
                if (_cdpConsoleLogs.Count > 0)
                {
                    var existing = new HashSet<string>(snapshot.ConsoleLogs.ConvertAll(c => c.Message));
                    foreach (var cdpLog in _cdpConsoleLogs)
                    {
                        if (!existing.Contains(cdpLog.Message))
                        {
                            snapshot.ConsoleLogs.Add(cdpLog);
                        }
                    }
                }

                if (_cdpNetworkLogs.Count > 0)
                {
                    var existingKeys = new HashSet<string>(snapshot.NetworkLogs.ConvertAll(n => $"{n.Method}:{n.Url}:{n.Status}"));
                    foreach (var cdpNet in _cdpNetworkLogs)
                    {
                        string key = $"{cdpNet.Method}:{cdpNet.Url}:{cdpNet.Status}";
                        if (!existingKeys.Contains(key))
                        {
                            snapshot.NetworkLogs.Add(cdpNet);
                        }
                    }
                }

                if (_cdpScriptErrors > 0 && snapshot.Performance != null)
                {
                    snapshot.Performance.ScriptErrorCount = Math.Max(snapshot.Performance.ScriptErrorCount, _cdpScriptErrors);
                }
            }

            return snapshot;
        }

        /// <summary>Fetches lightweight counts of captured diagnostics for UI badge displays.</summary>
        public static async Task<TelemetryCounts> GetCountsAsync(WebView2? webView)
        {
            var counts = new TelemetryCounts();

            if (webView?.CoreWebView2 != null)
            {
                try
                {
                    var raw = await webView.ExecuteScriptAsync(CountsScript);
                    if (!string.IsNullOrWhiteSpace(raw) && raw != "null")
                    {
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

                        var parsed = JsonSerializer.Deserialize<TelemetryCounts>(json, new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        });
                        if (parsed != null) counts = parsed;
                    }
                }
                catch { }
            }

            // Blend with real-time CDP counts
            lock (_cdpLock)
            {
                int cdpErrors = _cdpConsoleLogs.Count(l => l.Level == "error" || l.Level == "exception" || l.Level == "unhandledrejection");
                int cdpWarnings = _cdpConsoleLogs.Count(l => l.Level == "warn");
                int cdpNetFail = _cdpNetworkLogs.Count(n => n.Failed);

                counts.Errors = Math.Max(counts.Errors, cdpErrors);
                counts.Warnings = Math.Max(counts.Warnings, cdpWarnings);
                counts.NetworkFailures = Math.Max(counts.NetworkFailures, cdpNetFail);
                counts.TotalNetwork = Math.Max(counts.TotalNetwork, _cdpNetworkLogs.Count);
            }

            return counts;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Text;

namespace BuildConsole.Services
{
    /// <summary>Represents a single captured browser console log, warning, error, or unhandled exception with stack trace.</summary>
    public sealed class ConsoleLogItem
    {
        public string Level { get; set; } = "error"; // "error", "warn", "info", "log", "exception", "unhandledrejection"
        public string Message { get; set; } = "";
        public string StackTrace { get; set; } = "";
        public string Timestamp { get; set; } = "";
    }

    /// <summary>Represents a captured network request with status, timing duration, and payload size.</summary>
    public sealed class NetworkFailureItem
    {
        public string Method { get; set; } = "GET";
        public string Url { get; set; } = "";
        public int Status { get; set; }
        public string StatusText { get; set; } = "";
        public double DurationMs { get; set; }
        public string PayloadSize { get; set; } = "";
        public string Timestamp { get; set; } = "";
        public bool Failed { get; set; } = true;
    }

    /// <summary>Represents captured browser performance signals for the page under test.</summary>
    public sealed class PerformanceSignals
    {
        public double PageLoadTimeMs { get; set; }
        public double DnsTimeMs { get; set; }
        public double TcpTimeMs { get; set; }
        public double TtfbMs { get; set; }
        public double DomContentLoadedMs { get; set; }
        public double? FirstContentfulPaintMs { get; set; }
        public double? LargestContentfulPaintMs { get; set; }
        public int ScriptErrorCount { get; set; }
    }

    /// <summary>Represents a captured user action / reproduction step (click, button press, input, navigation, submit, DOM mutation).</summary>
    public sealed class ReproductionEventItem
    {
        public string ActionType { get; set; } = "CLICK"; // "CLICK", "BUTTON_PRESS", "INPUT", "NAVIGATE", "SUBMIT", "DOM_MUTATION"
        public string Selector { get; set; } = "";
        public string OuterHtml { get; set; } = "";
        public string Details { get; set; } = "";
        public string Timestamp { get; set; } = "";

        // Backward compatibility properties:
        public string EventType
        {
            get => !string.IsNullOrEmpty(ActionType) ? ActionType : "CLICK";
            set => ActionType = value;
        }

        public string Target
        {
            get => !string.IsNullOrEmpty(Selector) ? Selector : OuterHtml;
            set => Selector = value;
        }
    }

    /// <summary>
    /// Represents a single tracked issue / bug entry logged while testing a page.
    /// Includes:
    /// - Auto-collected metadata (URL, timestamp, browser/WebView2 version, OS, window/viewport size, user agent, title)
    /// - User-entered content (notes, steps to reproduce, expected vs actual behavior, severity, tags/categories)
    /// - Performance signals (page load time, LCP, FCP, TTFB, DOMContentLoaded, script error count)
    /// - Attachments & diagnostics (screenshots, console logs with stack traces, network logs with timing/payload, reproduction events)
    /// Persisted both to local JSON store (%AppData%\BuildConsole\visual-test-tracker\) and to Postgres when available.
    /// </summary>
    public sealed class VisualTestTrackerEntry
    {
        public int Id { get; set; }
        public string EntryUuid { get; set; } = Guid.NewGuid().ToString("N");
        public int PageId { get; set; }
        public string BaseUrl { get; set; } = "";
        public string PagePath { get; set; } = "";
        public string Title { get; set; } = "";

        // ── User-Entered Content ────────────────────────────────────────────────
        public string Notes { get; set; } = "";
        public string StepsToReproduce { get; set; } = "";
        public string ExpectedBehavior { get; set; } = "";
        public string ActualBehavior { get; set; } = "";
        public string Severity { get; set; } = "Bug"; // "Blocker", "Critical", "Bug", "UI Glitch", "Functional", "Low"
        public string Status { get; set; } = "Open"; // "Open", "Resolved"
        public List<string> Tags { get; set; } = new();

        // ── Auto-Collected Metadata ─────────────────────────────────────────────
        public string CurrentUrl { get; set; } = "";
        public string PageTitle { get; set; } = "";
        public string BrowserVersion { get; set; } = "";
        public string OsVersion { get; set; } = "";
        public string WindowSize { get; set; } = "";
        public string ViewportSize { get; set; } = "";
        public string UserAgent { get; set; } = "";

        // ── Performance Signals ─────────────────────────────────────────────────
        public PerformanceSignals? Performance { get; set; }

        // ── Attachments & Diagnostics ───────────────────────────────────────────
        public List<string> ScreenshotPaths { get; set; } = new();
        public List<ConsoleLogItem> ConsoleLogs { get; set; } = new();
        public List<NetworkFailureItem> NetworkFailures { get; set; } = new();
        public List<ReproductionEventItem> ReproductionEvents { get; set; } = new();

        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;

        /// <summary>Formats this bug report as complete, GitHub/Jira-ready Markdown.</summary>
        public string ToMarkdown()
        {
            var sb = new StringBuilder();
            string displayTitle = !string.IsNullOrWhiteSpace(Title)
                ? Title
                : (!string.IsNullOrWhiteSpace(Notes) ? Notes.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)[0].Trim() : "Visual Observation");

            sb.AppendLine($"### [{Severity.ToUpperInvariant()}] {displayTitle}");
            sb.AppendLine($"- **Status**: {Status}");
            if (Tags != null && Tags.Count > 0)
            {
                sb.AppendLine($"- **Tags / Categories**: {string.Join(", ", Tags.ConvertAll(t => $"`{t.Trim('#')}`"))}");
            }
            sb.AppendLine($"- **Recorded**: {CreatedAt:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine();

            // Environment & Auto-Collected Metadata Table
            sb.AppendLine("#### Auto-Collected Environment & Metadata");
            sb.AppendLine("| Property | Value |");
            sb.AppendLine("| :--- | :--- |");
            string effectiveUrl = !string.IsNullOrWhiteSpace(CurrentUrl) ? CurrentUrl : $"{BaseUrl}{PagePath}";
            sb.AppendLine($"| **URL** | `{effectiveUrl}` |");
            if (!string.IsNullOrWhiteSpace(PageTitle))
                sb.AppendLine($"| **Page Title** | {PageTitle} |");
            if (!string.IsNullOrWhiteSpace(BrowserVersion))
                sb.AppendLine($"| **Browser / WebView2** | `{BrowserVersion}` |");
            if (!string.IsNullOrWhiteSpace(OsVersion))
                sb.AppendLine($"| **Operating System** | {OsVersion} |");
            if (!string.IsNullOrWhiteSpace(ViewportSize) || !string.IsNullOrWhiteSpace(WindowSize))
            {
                string sizeStr = $"Viewport: {ViewportSize}";
                if (!string.IsNullOrWhiteSpace(WindowSize)) sizeStr += $" · Window: {WindowSize}";
                sb.AppendLine($"| **Viewport / Window** | {sizeStr} |");
            }
            if (!string.IsNullOrWhiteSpace(UserAgent))
                sb.AppendLine($"| **User Agent** | `{UserAgent}` |");
            sb.AppendLine();

            // Performance Signals Table
            if (Performance != null)
            {
                sb.AppendLine("#### Performance Signals");
                sb.AppendLine("| Metric | Measurement |");
                sb.AppendLine("| :--- | :--- |");
                if (Performance.PageLoadTimeMs > 0)
                    sb.AppendLine($"| **Page Load Time** | `{Performance.PageLoadTimeMs:F0} ms` |");
                if (Performance.LargestContentfulPaintMs.HasValue && Performance.LargestContentfulPaintMs.Value > 0)
                    sb.AppendLine($"| **Largest Contentful Paint (LCP)** | `{Performance.LargestContentfulPaintMs.Value:F0} ms` |");
                if (Performance.FirstContentfulPaintMs.HasValue && Performance.FirstContentfulPaintMs.Value > 0)
                    sb.AppendLine($"| **First Contentful Paint (FCP)** | `{Performance.FirstContentfulPaintMs.Value:F0} ms` |");
                if (Performance.TtfbMs > 0)
                    sb.AppendLine($"| **Time to First Byte (TTFB)** | `{Performance.TtfbMs:F0} ms` |");
                if (Performance.DomContentLoadedMs > 0)
                    sb.AppendLine($"| **DOM Content Loaded** | `{Performance.DomContentLoadedMs:F0} ms` |");
                if (Performance.ScriptErrorCount > 0)
                    sb.AppendLine($"| **Script Execution Errors** | `{Performance.ScriptErrorCount}` |");
                sb.AppendLine();
            }

            // Notes / Summary
            sb.AppendLine("#### Notes / Summary");
            sb.AppendLine(string.IsNullOrWhiteSpace(Notes) ? "_(No notes provided)_" : Notes.Trim());
            sb.AppendLine();

            // Steps to Reproduce
            if (!string.IsNullOrWhiteSpace(StepsToReproduce))
            {
                sb.AppendLine("#### Steps to Reproduce");
                sb.AppendLine(StepsToReproduce.Trim());
                sb.AppendLine();
            }

            // Expected vs Actual Behavior
            if (!string.IsNullOrWhiteSpace(ExpectedBehavior) || !string.IsNullOrWhiteSpace(ActualBehavior))
            {
                sb.AppendLine("#### Expected vs Actual Behavior");
                if (!string.IsNullOrWhiteSpace(ExpectedBehavior))
                {
                    sb.AppendLine($"- **Expected**: {ExpectedBehavior.Trim()}");
                }
                if (!string.IsNullOrWhiteSpace(ActualBehavior))
                {
                    sb.AppendLine($"- **Actual**: {ActualBehavior.Trim()}");
                }
                sb.AppendLine();
            }

            // Screenshots
            if (ScreenshotPaths != null && ScreenshotPaths.Count > 0)
            {
                sb.AppendLine($"#### Attachments: Screenshots ({ScreenshotPaths.Count})");
                foreach (var path in ScreenshotPaths)
                {
                    sb.AppendLine($"- `{path}`");
                }
                sb.AppendLine();
            }

            // Diagnostic: Console Logs & Stack Traces
            if (ConsoleLogs != null && ConsoleLogs.Count > 0)
            {
                sb.AppendLine($"#### Diagnostic: Console Logs & JavaScript Errors ({ConsoleLogs.Count})");
                sb.AppendLine("```text");
                foreach (var log in ConsoleLogs)
                {
                    string stamp = !string.IsNullOrWhiteSpace(log.Timestamp) ? $"[{log.Timestamp}] " : "";
                    sb.AppendLine($"{stamp}[{log.Level.ToUpperInvariant()}] {log.Message}");
                    if (!string.IsNullOrWhiteSpace(log.StackTrace))
                    {
                        var stackLines = log.StackTrace.Split('\n');
                        foreach (var sl in stackLines)
                        {
                            var trimmed = sl.Trim();
                            if (!string.IsNullOrWhiteSpace(trimmed)) sb.AppendLine($"    at {trimmed}");
                        }
                    }
                }
                sb.AppendLine("```");
                sb.AppendLine();
            }

            // Diagnostic: Network Logs & Failures
            if (NetworkFailures != null && NetworkFailures.Count > 0)
            {
                sb.AppendLine($"#### Diagnostic: Network Logs & Failures ({NetworkFailures.Count})");
                sb.AppendLine("| Method | Status | URL | Duration | Payload Size | Time |");
                sb.AppendLine("| :--- | :--- | :--- | :--- | :--- | :--- |");
                foreach (var net in NetworkFailures)
                {
                    string durationStr = net.DurationMs > 0 ? $"{net.DurationMs:F0} ms" : "-";
                    string sizeStr = !string.IsNullOrWhiteSpace(net.PayloadSize) ? net.PayloadSize : "-";
                    sb.AppendLine($"| **{net.Method}** | {net.Status} {net.StatusText} | `{net.Url}` | {durationStr} | {sizeStr} | {net.Timestamp} |");
                }
                sb.AppendLine();
            }

            // Diagnostic: Automated Reproduction Steps
            if (ReproductionEvents != null && ReproductionEvents.Count > 0)
            {
                sb.AppendLine($"#### Automated Reproduction Steps ({ReproductionEvents.Count})");
                int step = 1;
                foreach (var ev in ReproductionEvents)
                {
                    string action = !string.IsNullOrWhiteSpace(ev.ActionType) ? ev.ActionType.ToUpperInvariant() : "ACTION";
                    string stamp = !string.IsNullOrWhiteSpace(ev.Timestamp) ? $" `{ev.Timestamp}`" : "";
                    string target = !string.IsNullOrWhiteSpace(ev.Selector) ? $"`{ev.Selector}`" : (!string.IsNullOrWhiteSpace(ev.Target) ? $"`{ev.Target}`" : "");
                    string details = !string.IsNullOrWhiteSpace(ev.Details) ? $" — {ev.Details}" : "";

                    sb.AppendLine($"{step++}.{stamp} **[{action}]** {target}{details}");
                    if (!string.IsNullOrWhiteSpace(ev.OuterHtml))
                    {
                        sb.AppendLine("   ```html");
                        sb.AppendLine($"   {ev.OuterHtml.Trim()}");
                        sb.AppendLine("   ```");
                    }
                }
                sb.AppendLine();
            }

            return sb.ToString();
        }
    }
}

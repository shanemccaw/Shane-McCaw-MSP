using System;
using System.Collections.Generic;
using System.Text;

namespace BuildConsole.Services
{
    /// <summary>Represents a single captured browser console log, warning, or unhandled error.</summary>
    public sealed class ConsoleLogItem
    {
        public string Level { get; set; } = "error"; // "error", "warn", "exception", "unhandledrejection"
        public string Message { get; set; } = "";
        public string Timestamp { get; set; } = "";
    }

    /// <summary>Represents a captured failed network request (HTTP 4xx/5xx or network drop).</summary>
    public sealed class NetworkFailureItem
    {
        public string Method { get; set; } = "GET";
        public string Url { get; set; } = "";
        public int Status { get; set; }
        public string StatusText { get; set; } = "";
        public string Timestamp { get; set; } = "";
    }

    /// <summary>Represents a captured user interaction event leading up to the bug (breadcrumb).</summary>
    public sealed class ReproductionEventItem
    {
        public string EventType { get; set; } = "click"; // "click", "change", "submit"
        public string Target { get; set; } = "";
        public string Details { get; set; } = "";
        public string Timestamp { get; set; } = "";
    }

    /// <summary>
    /// Represents a single tracked issue / bug entry logged while testing a page.
    /// Includes:
    /// - Auto-collected metadata (URL, timestamp, browser/WebView2 version, OS, window/viewport size, user agent, title)
    /// - User-entered content (notes, steps to reproduce, expected vs actual behavior, severity, tags/categories)
    /// - Attachments (screenshots, console logs, network failures, reproduction events)
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

            // Diagnostic: Console Logs
            if (ConsoleLogs != null && ConsoleLogs.Count > 0)
            {
                sb.AppendLine($"#### Attachments: Console Logs ({ConsoleLogs.Count})");
                sb.AppendLine("```text");
                foreach (var log in ConsoleLogs)
                {
                    string stamp = !string.IsNullOrWhiteSpace(log.Timestamp) ? $"[{log.Timestamp}] " : "";
                    sb.AppendLine($"{stamp}[{log.Level.ToUpperInvariant()}] {log.Message}");
                }
                sb.AppendLine("```");
                sb.AppendLine();
            }

            // Diagnostic: Network Failures
            if (NetworkFailures != null && NetworkFailures.Count > 0)
            {
                sb.AppendLine($"#### Attachments: Network Failures ({NetworkFailures.Count})");
                sb.AppendLine("| Method | Status | URL | Time |");
                sb.AppendLine("| :--- | :--- | :--- | :--- |");
                foreach (var net in NetworkFailures)
                {
                    sb.AppendLine($"| **{net.Method}** | {net.Status} {net.StatusText} | `{net.Url}` | {net.Timestamp} |");
                }
                sb.AppendLine();
            }

            // Diagnostic: Reproduction Events
            if (ReproductionEvents != null && ReproductionEvents.Count > 0)
            {
                sb.AppendLine($"#### Attachments: Reproduction Events ({ReproductionEvents.Count})");
                int step = 1;
                foreach (var ev in ReproductionEvents)
                {
                    string details = !string.IsNullOrWhiteSpace(ev.Details) ? $" — \"{ev.Details}\"" : "";
                    string stamp = !string.IsNullOrWhiteSpace(ev.Timestamp) ? $" `{ev.Timestamp}`" : "";
                    sb.AppendLine($"{step++}.{stamp} **{ev.EventType}** on `{ev.Target}`{details}");
                }
                sb.AppendLine();
            }

            return sb.ToString();
        }
    }
}

using System;
using System.Collections.Generic;

namespace BuildConsole.Services
{
    /// <summary>
    /// Represents a single tracked issue / bug entry logged while testing a page.
    /// Combines notes, severity, status, and one or more associated screenshot files.
    /// Persisted both to local JSON store (%AppData%\BuildConsole\visual-test-tracker\)
    /// and to Postgres when available.
    /// </summary>
    public sealed class VisualTestTrackerEntry
    {
        public int Id { get; set; }
        public string EntryUuid { get; set; } = Guid.NewGuid().ToString("N");
        public int PageId { get; set; }
        public string BaseUrl { get; set; } = "";
        public string PagePath { get; set; } = "";
        public string Title { get; set; } = "";
        public string Notes { get; set; } = "";
        public string Severity { get; set; } = "Bug"; // "Bug", "UI Glitch", "Functional", "Blocker"
        public string Status { get; set; } = "Open"; // "Open", "Resolved"
        public List<string> ScreenshotPaths { get; set; } = new();
        public DateTime CreatedAt { get; set; } = DateTime.Now;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;

        /// <summary>Formats this entry as GitHub-flavored Markdown suitable for copying into tickets or chat.</summary>
        public string ToMarkdown()
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine($"### [{Severity.ToUpperInvariant()}] {(!string.IsNullOrWhiteSpace(Title) ? Title : Notes.Split('\n')[0].Trim())}");
            sb.AppendLine($"- **Status**: {Status}");
            sb.AppendLine($"- **Page**: `{BaseUrl}{PagePath}`");
            sb.AppendLine($"- **Recorded**: {CreatedAt:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine();
            sb.AppendLine("#### Notes");
            sb.AppendLine(string.IsNullOrWhiteSpace(Notes) ? "_(No notes provided)_" : Notes.Trim());
            sb.AppendLine();

            if (ScreenshotPaths != null && ScreenshotPaths.Count > 0)
            {
                sb.AppendLine("#### Screenshots");
                foreach (var path in ScreenshotPaths)
                {
                    sb.AppendLine($"- `{path}`");
                }
            }

            return sb.ToString();
        }
    }
}

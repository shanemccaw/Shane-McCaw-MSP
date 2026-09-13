using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Represents a single testing session for a specific page/route.
    /// Tracks test duration, bug entries logged, telemetry interactions, and clean status.
    /// </summary>
    public sealed class VisualTestTrackerSession
    {
        public string SessionId { get; set; } = Guid.NewGuid().ToString("N");
        public string BaseUrl { get; set; } = "";
        public string PagePath { get; set; } = "";
        public DateTime StartedAt { get; set; } = DateTime.Now;
        public DateTime? EndedAt { get; set; }
        public double AccumulatedSeconds { get; set; }
        public int BugsLoggedCount { get; set; }
        public int TelemetryEventsCount { get; set; }
        public bool IsCleanConfirmed { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime LastActiveAt { get; set; } = DateTime.Now;

        /// <summary>
        /// Set to the formatted SessionId (yyyy-MM-dd-HHmm) after a successful End &amp; Sync so
        /// the SessionHistoryDialog can locate report.json and display the ✓ Synced pill.
        /// Empty string means this session has never been synced.
        /// </summary>
        public string SyncedSessionId { get; set; } = "";

        [System.Text.Json.Serialization.JsonIgnore]
        public TimeSpan TotalElapsed
        {
            get
            {
                var baseSpan = TimeSpan.FromSeconds(Math.Max(0, AccumulatedSeconds));
                if (IsActive && EndedAt == null)
                {
                    var ongoing = DateTime.Now - LastActiveAt;
                    if (ongoing > TimeSpan.Zero)
                        baseSpan += ongoing;
                }
                return baseSpan;
            }
        }

        [System.Text.Json.Serialization.JsonIgnore]
        public string FormattedDuration
        {
            get
            {
                var el = TotalElapsed;
                if (el.TotalHours >= 1)
                    return $"{(int)el.TotalHours}h {el.Minutes:D2}m {el.Seconds:D2}s";
                return $"{el.Minutes:D2}m {el.Seconds:D2}s";
            }
        }

        [System.Text.Json.Serialization.JsonIgnore]
        public string DisplayRoute => !string.IsNullOrWhiteSpace(PagePath) ? PagePath : "/";
    }

    /// <summary>
    /// Persistent store for test sessions, saving to %AppData%\BuildConsole\visual-test-tracker\sessions.json.
    /// Manages per-page active sessions, session switching, and historical audit logs.
    /// </summary>
    public static class VisualTestTrackerSessionStore
    {
        private static string SessionsFilePath
        {
            get
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "visual-test-tracker");
                Directory.CreateDirectory(dir);
                return Path.Combine(dir, "sessions.json");
            }
        }

        private static readonly object _lock = new();

        public static List<VisualTestTrackerSession> LoadAll()
        {
            lock (_lock)
            {
                try
                {
                    var file = SessionsFilePath;
                    if (!File.Exists(file)) return new List<VisualTestTrackerSession>();
                    var json = File.ReadAllText(file);
                    return JsonSerializer.Deserialize<List<VisualTestTrackerSession>>(json)
                           ?? new List<VisualTestTrackerSession>();
                }
                catch
                {
                    return new List<VisualTestTrackerSession>();
                }
            }
        }

        public static void SaveAll(List<VisualTestTrackerSession> sessions)
        {
            lock (_lock)
            {
                try
                {
                    var file = SessionsFilePath;
                    var opts = new JsonSerializerOptions { WriteIndented = true };
                    var json = JsonSerializer.Serialize(sessions, opts);
                    File.WriteAllText(file, json);
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("visual-test-tracker", $"Session save error: {ex.Message}");
                }
            }
        }

        /// <summary>
        /// Retrieves the active session for a specific URL/route, or creates a new one if none exists.
        /// </summary>
        public static VisualTestTrackerSession GetOrCreateActiveSession(string baseUrl, string pagePath)
        {
            var all = LoadAll();
            var active = all.FirstOrDefault(s => s.IsActive &&
                string.Equals(s.BaseUrl, baseUrl, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(s.PagePath, pagePath, StringComparison.OrdinalIgnoreCase));

            if (active != null)
            {
                // Resume active session
                active.LastActiveAt = DateTime.Now;
                SaveAll(all);
                return active;
            }

            // Create new session for this page
            var newSession = new VisualTestTrackerSession
            {
                BaseUrl = baseUrl ?? "",
                PagePath = pagePath ?? "",
                StartedAt = DateTime.Now,
                LastActiveAt = DateTime.Now,
                IsActive = true
            };
            all.Insert(0, newSession);
            SaveAll(all);
            return newSession;
        }

        /// <summary>
        /// Pauses the currently active session on page navigation, updating accumulated elapsed seconds.
        /// </summary>
        public static void PauseSession(VisualTestTrackerSession? session)
        {
            if (session == null || !session.IsActive) return;

            var all = LoadAll();
            var target = all.FirstOrDefault(s => s.SessionId == session.SessionId);
            if (target != null)
            {
                var delta = DateTime.Now - target.LastActiveAt;
                if (delta > TimeSpan.Zero)
                {
                    target.AccumulatedSeconds += delta.TotalSeconds;
                }
                target.LastActiveAt = DateTime.Now;
                SaveAll(all);
            }
        }

        /// <summary>
        /// Ends the current session, recording final duration and marking IsActive = false,
        /// and starts a brand new active session for the specified page.
        /// </summary>
        public static VisualTestTrackerSession StartNewSession(string baseUrl, string pagePath, VisualTestTrackerSession? previousSession = null)
        {
            var all = LoadAll();

            // End previous session if provided
            if (previousSession != null)
            {
                var prev = all.FirstOrDefault(s => s.SessionId == previousSession.SessionId);
                if (prev != null)
                {
                    var delta = DateTime.Now - prev.LastActiveAt;
                    if (delta > TimeSpan.Zero)
                    {
                        prev.AccumulatedSeconds += delta.TotalSeconds;
                    }
                    prev.EndedAt = DateTime.Now;
                    prev.IsActive = false;
                }
            }

            // Also ensure any existing active session for this page is closed
            foreach (var s in all.Where(s => s.IsActive &&
                string.Equals(s.BaseUrl, baseUrl, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(s.PagePath, pagePath, StringComparison.OrdinalIgnoreCase)))
            {
                s.EndedAt = DateTime.Now;
                s.IsActive = false;
            }

            // Create fresh session
            var fresh = new VisualTestTrackerSession
            {
                BaseUrl = baseUrl ?? "",
                PagePath = pagePath ?? "",
                StartedAt = DateTime.Now,
                LastActiveAt = DateTime.Now,
                IsActive = true
            };
            all.Insert(0, fresh);
            SaveAll(all);
            return fresh;
        }

        /// <summary>
        /// Updates the session stats (e.g. bug count, clean confirmed, telemetry events).
        /// </summary>
        public static void UpdateSession(VisualTestTrackerSession session)
        {
            if (session == null) return;
            var all = LoadAll();
            var idx = all.FindIndex(s => s.SessionId == session.SessionId);
            if (idx >= 0)
            {
                all[idx] = session;
                SaveAll(all);
            }
        }

        /// <summary>
        /// Returns all sessions ordered by start time descending.
        /// </summary>
        public static List<VisualTestTrackerSession> GetHistory()
        {
            return LoadAll().OrderByDescending(s => s.StartedAt).ToList();
        }

        /// <summary>
        /// Purges all session history from disk.
        /// </summary>
        public static void ClearHistory()
        {
            SaveAll(new List<VisualTestTrackerSession>());
        }

        /// <summary>
        /// Generates a complete Markdown test audit log summary of all historical sessions.
        /// </summary>
        public static string ToMarkdownAuditLog(IEnumerable<VisualTestTrackerSession> sessions)
        {
            var sb = new StringBuilder();
            sb.AppendLine("# Visual Test Tracker — Session History & Audit Trail");
            sb.AppendLine($"**Generated**: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            sb.AppendLine();

            var list = sessions?.ToList() ?? new List<VisualTestTrackerSession>();
            if (list.Count == 0)
            {
                sb.AppendLine("*No session records found.*");
                return sb.ToString();
            }

            sb.AppendLine("| Date | Page / Route | Base URL | Duration | Status | Bugs Logged | Actions Tracked |");
            sb.AppendLine("| :--- | :--- | :--- | :--- | :--- | :---: | :---: |");

            foreach (var s in list)
            {
                string status = s.IsCleanConfirmed ? "✅ Confirmed Clean" : (s.BugsLoggedCount > 0 ? "🐞 Issues Found" : "🔍 Tested");
                sb.AppendLine($"| {s.StartedAt:yyyy-MM-dd HH:mm} | `{s.DisplayRoute}` | `{s.BaseUrl}` | {s.FormattedDuration} | {status} | {s.BugsLoggedCount} | {s.TelemetryEventsCount} |");
            }

            return sb.ToString();
        }
    }
}

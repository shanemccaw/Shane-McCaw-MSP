using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Crash-safe persistent store for in-progress draft notes, steps, expected/actual behavior,
    /// tags, severity, and staged screenshots, as well as cross-page Global Notes.
    /// Saves immediately to %AppData%\BuildConsole\visual-test-tracker\drafts.json and global-notes.md
    /// on every keystroke or capture, ensuring all bug composition fields survive page navigation,
    /// application restarts, and crashes.
    /// </summary>
    public static class VisualTestTrackerDraftStore
    {
        public sealed class PageDraft
        {
            public string BaseUrl { get; set; } = "";
            public string PagePath { get; set; } = "";
            public string Notes { get; set; } = "";
            public string StepsToReproduce { get; set; } = "";
            public string ExpectedBehavior { get; set; } = "";
            public string ActualBehavior { get; set; } = "";
            public string Tags { get; set; } = "";
            public string Severity { get; set; } = "Bug";
            public List<string> StagedScreenshots { get; set; } = new();
            public DateTime LastSavedAt { get; set; } = DateTime.Now;
        }

        private static string DraftsFilePath
        {
            get
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "visual-test-tracker");
                Directory.CreateDirectory(dir);
                return Path.Combine(dir, "drafts.json");
            }
        }

        private static string GlobalNotesFilePath
        {
            get
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "visual-test-tracker");
                Directory.CreateDirectory(dir);
                return Path.Combine(dir, "global-notes.md");
            }
        }

        private static readonly object _lock = new();

        private static Dictionary<string, PageDraft> LoadAll()
        {
            lock (_lock)
            {
                try
                {
                    var file = DraftsFilePath;
                    if (!File.Exists(file)) return new Dictionary<string, PageDraft>(StringComparer.OrdinalIgnoreCase);
                    var json = File.ReadAllText(file);
                    return JsonSerializer.Deserialize<Dictionary<string, PageDraft>>(json)
                           ?? new Dictionary<string, PageDraft>(StringComparer.OrdinalIgnoreCase);
                }
                catch
                {
                    return new Dictionary<string, PageDraft>(StringComparer.OrdinalIgnoreCase);
                }
            }
        }

        private static void PersistAll(Dictionary<string, PageDraft> dict)
        {
            lock (_lock)
            {
                try
                {
                    var file = DraftsFilePath;
                    var opts = new JsonSerializerOptions { WriteIndented = true };
                    var json = JsonSerializer.Serialize(dict, opts);
                    File.WriteAllText(file, json);
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("visual-test-tracker", $"Drafts save error: {ex.Message}");
                }
            }
        }

        private static string MakeKey(string baseUrl, string pagePath) =>
            $"{baseUrl?.Trim().ToLowerInvariant()}::{pagePath?.Trim().ToLowerInvariant()}";

        public static void SaveDraft(
            string baseUrl,
            string pagePath,
            string notes,
            string stepsToReproduce,
            string expectedBehavior,
            string actualBehavior,
            string tags,
            string severity,
            List<string> stagedScreenshots)
        {
            if (string.IsNullOrWhiteSpace(baseUrl)) return;
            var key = MakeKey(baseUrl, pagePath);
            var all = LoadAll();
            all[key] = new PageDraft
            {
                BaseUrl = baseUrl,
                PagePath = pagePath,
                Notes = notes ?? "",
                StepsToReproduce = stepsToReproduce ?? "",
                ExpectedBehavior = expectedBehavior ?? "",
                ActualBehavior = actualBehavior ?? "",
                Tags = tags ?? "",
                Severity = severity ?? "Bug",
                StagedScreenshots = stagedScreenshots != null ? new List<string>(stagedScreenshots) : new List<string>(),
                LastSavedAt = DateTime.Now
            };
            PersistAll(all);
        }

        public static void SaveDraft(string baseUrl, string pagePath, string notes, string severity, List<string> stagedScreenshots)
        {
            SaveDraft(baseUrl, pagePath, notes, "", "", "", "", severity, stagedScreenshots);
        }

        public static PageDraft? GetDraft(string baseUrl, string pagePath)
        {
            if (string.IsNullOrWhiteSpace(baseUrl)) return null;
            var key = MakeKey(baseUrl, pagePath);
            var all = LoadAll();
            return all.TryGetValue(key, out var draft) ? draft : null;
        }

        public static void ClearDraft(string baseUrl, string pagePath)
        {
            if (string.IsNullOrWhiteSpace(baseUrl)) return;
            var key = MakeKey(baseUrl, pagePath);
            var all = LoadAll();
            if (all.Remove(key))
            {
                PersistAll(all);
            }
        }

        // ── Global Cross-Page Notes ──────────────────────────────────────────────

        public static string LoadGlobalNotes()
        {
            lock (_lock)
            {
                try
                {
                    var file = GlobalNotesFilePath;
                    return File.Exists(file) ? File.ReadAllText(file) : "";
                }
                catch
                {
                    return "";
                }
            }
        }

        public static void SaveGlobalNotes(string text)
        {
            lock (_lock)
            {
                try
                {
                    var file = GlobalNotesFilePath;
                    File.WriteAllText(file, text ?? "");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("visual-test-tracker", $"Global notes save error: {ex.Message}");
                }
            }
        }
    }
}

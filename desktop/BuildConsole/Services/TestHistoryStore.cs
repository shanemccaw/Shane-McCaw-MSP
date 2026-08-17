using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #968 (Epic #803) — one summary row per manifest run (timestamp, manifest, pass/fail
    /// counts, overall result), appended to test-results/_history.jsonl. Newline-delimited JSON
    /// on purpose, not a JSON array rewritten whole each run — appending a line is the append-only
    /// shape CLAUDE.md's Shared File Write Discipline section asks for, so two runs finishing close
    /// together can't clobber each other's row the way a read-whole/rewrite-whole array would.
    /// Local machine data only (test-results/ is gitignored, per #958), same as the full per-run
    /// result JSON this sits alongside.
    /// </summary>
    public class TestHistoryEntry
    {
        public int Issue { get; set; }
        public string Feature { get; set; } = "";
        public string Mode { get; set; } = "single";
        public DateTime StartedAt { get; set; }
        public int Total { get; set; }
        public int Passed { get; set; }
        public int Failed { get; set; }
        public bool AllPassed { get; set; }
        public string ResultFile { get; set; } = "";
    }

    /// <summary>
    /// A manifest's real run history is keyed by whichever identity it
    /// actually carries — a numeric GitHub `issue`, or a `feature` slug for
    /// manifests under the newer area/feature-slug convention (CLAUDE.md's
    /// discover-before-create rule) that were never filed as a single
    /// issue. Looking up ONLY by issue number (the original shape of this
    /// lookup) silently reads "never ran" for every feature-slug manifest
    /// even after real, repeated, passing runs — issue never ran into by
    /// LeftSidebar.PopulateManifestsList, which already did both lookups;
    /// GitDetailView's issue-detail cards/inline badges did not.
    /// </summary>
    public sealed class TestHistoryLookup
    {
        public Dictionary<int, TestHistoryEntry> ByIssue { get; } = new();
        public Dictionary<string, TestHistoryEntry> ByFeature { get; } = new(StringComparer.OrdinalIgnoreCase);

        public bool TryGetForManifest(int? issue, string? feature, out TestHistoryEntry? entry)
        {
            if (issue.HasValue && issue.Value > 0 && ByIssue.TryGetValue(issue.Value, out var byIssue))
            {
                entry = byIssue;
                return true;
            }
            if (!string.IsNullOrEmpty(feature) && ByFeature.TryGetValue(feature, out var byFeature))
            {
                entry = byFeature;
                return true;
            }
            entry = null;
            return false;
        }
    }

    public static class TestHistoryStore
    {
        private const string Channel = "testing.history";
        private const string FileName = "_history.jsonl";

        public static void Append(string repoRoot, ManifestRunResult result, string resultFilePath)
        {
            try
            {
                var dir = Path.Combine(repoRoot, "test-results");
                Directory.CreateDirectory(dir);
                var path = Path.Combine(dir, FileName);

                var entry = new TestHistoryEntry
                {
                    Issue = result.Issue,
                    Feature = result.Feature,
                    Mode = result.Mode,
                    StartedAt = result.StartedAt,
                    Total = result.Steps.Count,
                    Passed = result.Steps.Count(s => s.Passed),
                    Failed = result.Steps.Count(s => !s.Passed),
                    AllPassed = result.AllPassed,
                    ResultFile = Path.GetFileName(resultFilePath),
                };

                using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.Read))
                using (var writer = new StreamWriter(stream))
                {
                    writer.WriteLine(JsonSerializer.Serialize(entry));
                }

                ActivityLog.Log(Channel,
                    $"History appended for issue #{entry.Issue} ({entry.Passed}/{entry.Total} passed, allPassed={entry.AllPassed}).");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Couldn't append history: {ex.Message}");
            }
        }

        /// <summary>Chronological (oldest first). Malformed lines (e.g. a partial write left by a
        /// crash mid-append) are skipped rather than failing the whole read.</summary>
        public static List<TestHistoryEntry> ReadAll(string repoRoot)
        {
            var entries = new List<TestHistoryEntry>();
            var path = Path.Combine(repoRoot, "test-results", FileName);
            if (!File.Exists(path)) return entries;

            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new StreamReader(stream);
            string? line;
            while ((line = reader.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var entry = JsonSerializer.Deserialize<TestHistoryEntry>(line);
                    if (entry != null) entries.Add(entry);
                }
                catch (JsonException)
                {
                    // skip malformed line
                }
            }
            return entries.OrderBy(e => e.StartedAt).ToList();
        }
    }
}

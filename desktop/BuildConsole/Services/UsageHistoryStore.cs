using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// One observed usage-meter reading — a (timestamp, percentage) point plus the
    /// reset moment that was in force when it was read. The projection feature
    /// (time-until-100%) needs a real growth rate, and a rate needs history, so every
    /// successful <see cref="ClaudeUsageMeterService"/> poll persists one of these.
    /// </summary>
    public class UsageSample
    {
        /// <summary>When the reading was taken (LOCAL time — same clock everything else in this app uses).</summary>
        public DateTime At { get; set; }
        /// <summary>Whole-number usage percentage (0–100) that poll read.</summary>
        public int Percent { get; set; }
        /// <summary>The next-reset LOCAL datetime parsed from the "Resets …" label at that poll, or null when it couldn't be parsed. Used to detect a reset boundary between two samples (the target jumps forward a full period).</summary>
        public DateTime? ResetTarget { get; set; }
    }

    /// <summary>
    /// Append-only local time-series of usage readings, one JSON object per line at
    /// <c>%AppData%\BuildConsole\usage-history.jsonl</c>.
    ///
    /// Deliberately the SAME append-only-JSONL shape as <see cref="TestHistoryStore"/>
    /// (newline-delimited JSON, appended one line at a time rather than a whole-array
    /// rewrite) rather than a new storage mechanism — appending a line is crash-safe and
    /// can't clobber earlier points, and a malformed trailing line (a write cut off by a
    /// crash) is simply skipped on read. It lives next to settings.json in
    /// <c>%AppData%\BuildConsole\</c> because it's local-machine runtime data, not repo
    /// data (unlike test-results/, which is repo-relative).
    ///
    /// Only ONE BuildConsole process writes this (the single usage-meter poll timer), so
    /// no cross-process contention exists; a light compaction keeps the file bounded when
    /// it grows past <see cref="CompactWhenLinesExceed"/> lines.
    /// </summary>
    public static class UsageHistoryStore
    {
        public const string Channel = "usage-meter";
        private const string FileName = "usage-history.jsonl";

        // ~10-min polls → ~1000 points/week; keep well over a couple of reset windows'
        // worth before compacting, then retain the newest half. Reset-window scoping only
        // ever needs the current window, so old points past this are never read anyway.
        private const int CompactWhenLinesExceed = 8000;

        private static string Dir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole");

        private static string FilePath => Path.Combine(Dir, FileName);

        /// <summary>Appends one reading. Never throws out to the caller — a failed persist
        /// just means a missing point, logged, not a crashed poll. Returns true on success.</summary>
        public static bool Append(UsageSample sample)
        {
            try
            {
                Directory.CreateDirectory(Dir);
                using (var stream = new FileStream(FilePath, FileMode.Append, FileAccess.Write, FileShare.Read))
                using (var writer = new StreamWriter(stream))
                {
                    writer.WriteLine(JsonSerializer.Serialize(sample));
                }
                CompactIfLarge();
                return true;
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Couldn't persist usage data point: {ex.Message}");
                return false;
            }
        }

        /// <summary>Chronological (oldest first). Malformed lines (e.g. a partial write from a
        /// crash mid-append) are skipped rather than failing the whole read.</summary>
        public static List<UsageSample> ReadAll()
        {
            var samples = new List<UsageSample>();
            try
            {
                if (!File.Exists(FilePath)) return samples;
                using var stream = new FileStream(FilePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                using var reader = new StreamReader(stream);
                string? line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    try
                    {
                        var s = JsonSerializer.Deserialize<UsageSample>(line);
                        if (s != null) samples.Add(s);
                    }
                    catch (JsonException)
                    {
                        // skip malformed line
                    }
                }
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Couldn't read usage history: {ex.Message}");
            }
            return samples.OrderBy(s => s.At).ToList();
        }

        /// <summary>When the file grows past the cap, rewrite it keeping only the newest half.
        /// Single-writer, so a plain read-newest/rewrite is safe here. Best-effort — a failed
        /// compaction leaves the (still-usable) larger file in place.</summary>
        private static void CompactIfLarge()
        {
            try
            {
                var all = ReadAll();
                if (all.Count <= CompactWhenLinesExceed) return;

                var keep = all.Skip(all.Count - CompactWhenLinesExceed / 2).ToList();
                var tmp = FilePath + ".tmp";
                using (var stream = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream))
                {
                    foreach (var s in keep)
                        writer.WriteLine(JsonSerializer.Serialize(s));
                }
                File.Copy(tmp, FilePath, overwrite: true);
                File.Delete(tmp);
                ActivityLog.Log(Channel, $"Compacted usage history: kept newest {keep.Count} of {all.Count} points.");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Usage history compaction skipped: {ex.Message}");
            }
        }
    }
}

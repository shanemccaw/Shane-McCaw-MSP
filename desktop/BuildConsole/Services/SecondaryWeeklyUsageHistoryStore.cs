using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #1437 — the Secondary-account counterpart of <see cref="WeeklyUsageHistoryStore"/>.
    /// Append-only local time-series of the Secondary account's weekly usage readings, one JSON
    /// object per line at <c>%AppData%\BuildConsole\secondary-weekly-usage-history.jsonl</c>. Kept
    /// as a genuinely separate file (not a shared/tagged store) so the Primary and Secondary
    /// projection math can never cross-contaminate.
    /// </summary>
    public static class SecondaryWeeklyUsageHistoryStore
    {
        public const string Channel = "usage-meter";
        private const string FileName = "secondary-weekly-usage-history.jsonl";
        private const int CompactWhenLinesExceed = 8000;

        private static string Dir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole");

        private static string FilePath => Path.Combine(Dir, FileName);

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
                ActivityLog.Log(Channel, $"Couldn't persist secondary weekly usage data point: {ex.Message}");
                return false;
            }
        }

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
                ActivityLog.Log(Channel, $"Couldn't read secondary weekly usage history: {ex.Message}");
            }
            return samples.OrderBy(s => s.At).ToList();
        }

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
                ActivityLog.Log(Channel, $"Compacted secondary weekly usage history: kept newest {keep.Count} of {all.Count} points.");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Secondary weekly usage history compaction skipped: {ex.Message}");
            }
        }
    }
}

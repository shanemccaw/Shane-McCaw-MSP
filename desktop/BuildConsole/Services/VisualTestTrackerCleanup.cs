using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace BuildConsole.Services
{
    public class CleanupResult
    {
        public int FilesDeleted { get; set; }
        public long BytesFreed { get; set; }
        public int ErrorsEncountered { get; set; }

        public string SummaryDisplay
        {
            get
            {
                double mbFreed = BytesFreed / (1024.0 * 1024.0);
                return $"Cleaned {FilesDeleted} file(s), freed {mbFreed:F2} MB disk space.";
            }
        }
    }

    /// <summary>
    /// Disk retention & automatic cleanup service for Visual Test Tracker screenshot captures.
    /// Prevents unbounded disk growth by purging screenshots of resolved bugs older than retention threshold
    /// and orphaned capture PNGs no longer referenced in PostgreSQL or local JSON storage.
    /// </summary>
    public static class VisualTestTrackerCleanup
    {
        private const string Channel = VisualTestTrackerStore.Channel;

        public static string CapturesDirectory
        {
            get
            {
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole", "visual-test-tracker");
                Directory.CreateDirectory(dir);
                return dir;
            }
        }

        /// <summary>
        /// Executes full cleanup pipeline:
        /// 1. Purges screenshots of resolved bugs older than retention age (default 14 days).
        /// 2. Purges orphaned PNG files on disk not referenced by any active bug entry or screenshot row.
        /// </summary>
        public static async Task<CleanupResult> RunCleanupAsync(VisualTestTrackerStore? store, TimeSpan? retentionAge = null, int maxPerFolder = 50)
        {
            var result = new CleanupResult();
            TimeSpan maxAge = retentionAge ?? TimeSpan.FromDays(14);
            DateTime cutoff = DateTime.Now - maxAge;

            try
            {
                List<VisualTestTrackerEntry> allEntries;
                if (store != null)
                {
                    allEntries = await store.ListAllBugsAsync();
                }
                else
                {
                    allEntries = new List<VisualTestTrackerEntry>();
                }

                // 1. Gather all active screenshot file paths referenced by bug entries
                var activeFilePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var resolvedOldScreenshotPaths = new List<string>();

                foreach (var entry in allEntries)
                {
                    bool isResolvedOld = string.Equals(entry.Status, "Resolved", StringComparison.OrdinalIgnoreCase) && entry.UpdatedAt < cutoff;

                    if (entry.ScreenshotPaths != null)
                    {
                        foreach (var path in entry.ScreenshotPaths)
                        {
                            if (!string.IsNullOrWhiteSpace(path))
                            {
                                if (isResolvedOld)
                                {
                                    resolvedOldScreenshotPaths.Add(path);
                                }
                                else
                                {
                                    activeFilePaths.Add(path);
                                }
                            }
                        }
                    }
                }

                // Delete resolved old screenshots
                foreach (var path in resolvedOldScreenshotPaths)
                {
                    if (File.Exists(path))
                    {
                        try
                        {
                            long size = new FileInfo(path).Length;
                            File.Delete(path);
                            result.FilesDeleted++;
                            result.BytesFreed += size;
                        }
                        catch (Exception ex)
                        {
                            result.ErrorsEncountered++;
                            ActivityLog.Log(Channel, $"Failed deleting old resolved screenshot '{path}': {ex.Message}");
                        }
                    }
                }

                // 2. Scan captures directory for orphan PNGs
                var dir = CapturesDirectory;
                if (Directory.Exists(dir))
                {
                    var allPngs = Directory.GetFiles(dir, "*.png", SearchOption.AllDirectories);
                    foreach (var png in allPngs)
                    {
                        // If file is not in active set and older than 1 day (grace period)
                        if (!activeFilePaths.Contains(png))
                        {
                            try
                            {
                                var fi = new FileInfo(png);
                                if (fi.LastWriteTime < DateTime.Now.AddDays(-1))
                                {
                                    long size = fi.Length;
                                    fi.Delete();
                                    result.FilesDeleted++;
                                    result.BytesFreed += size;
                                }
                            }
                            catch (Exception ex)
                            {
                                result.ErrorsEncountered++;
                                ActivityLog.Log(Channel, $"Failed deleting orphan PNG '{png}': {ex.Message}");
                            }
                        }
                    }
                }

                ActivityLog.Log(Channel, $"Cleanup complete: {result.SummaryDisplay}");
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Error running test file cleanup: {ex.Message}");
            }

            return result;
        }
    }
}

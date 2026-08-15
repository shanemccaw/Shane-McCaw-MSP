using System;
using System.IO;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Reads the SAME config Shane already set up for scripts/build-queue-watcher.ps1
    /// (scripts/build-queue-watcher.config.json - apiBaseUrl/ingestToken/maxConcurrent)
    /// rather than inventing a second, separate config entry for this app to duplicate
    /// and drift out of sync with. Walks up from wherever the exe is running (bin/Debug
    /// or bin/Release under desktop/BuildConsole) to find the repo root's scripts/
    /// folder, so this works regardless of build configuration or exactly where the
    /// repo is cloned.
    /// </summary>
    public class BuildTrackerConfig
    {
        public string ApiBaseUrl { get; set; } = "";
        public string IngestToken { get; set; } = "";
        public int MaxConcurrent { get; set; } = 8;

        /// <summary>
        /// DEPRECATED / no longer used. This once held a direct Postgres connection string
        /// for an earlier <c>shaneapp://executeSql</c> design that opened its own local
        /// Npgsql connection — a design that always failed "no local Postgres connection
        /// string configured" because it was never set. <c>executeSql</c> now routes SQL
        /// through the SAME pipe the manual SQL Runner uses
        /// (<see cref="BuildTrackerApiClient.ExecuteSqlAsync"/> →
        /// <c>POST /api/simulator/sql/execute</c>), so no separate connection string is
        /// required. Kept only so an old config file carrying this key still deserializes
        /// cleanly; nothing reads it anymore.
        /// </summary>
        public string DatabaseUrl { get; set; } = "";

        public bool IsConfigured => !string.IsNullOrWhiteSpace(ApiBaseUrl) && !string.IsNullOrWhiteSpace(IngestToken);

        public static string? FindConfigPath()
        {
            var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "scripts", "build-queue-watcher.config.json");
                if (File.Exists(candidate)) return candidate;
                dir = dir.Parent;
            }
            return null;
        }

        /// <summary>Git #817 — QueueWatcherService needs the repo root as claude.exe's default working directory (same as build-queue-watcher.ps1's `$repoRoot = Split-Path $PSScriptRoot -Parent`); derived from the same config file's location rather than a second hardcoded path.</summary>
        public static string? FindRepoRoot()
        {
            var configPath = FindConfigPath();
            if (configPath == null) return null;
            return Directory.GetParent(Path.GetDirectoryName(configPath)!)?.FullName;
        }

        public static BuildTrackerConfig Load()
        {
            var path = FindConfigPath();
            if (path == null) return new BuildTrackerConfig();
            try
            {
                var json = File.ReadAllText(path);
                var cfg = JsonSerializer.Deserialize<BuildTrackerConfig>(
                    json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return cfg ?? new BuildTrackerConfig();
            }
            catch
            {
                return new BuildTrackerConfig();
            }
        }
    }
}

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

        public string DevBaseUrl { get; set; } = "http://localhost:8080";
        public string StagingBaseUrl { get; set; } = "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/";
        public string ProductionBaseUrl { get; set; } = "https://shanemccaw.com";

        /// <summary>
        /// Returns the base URL for the given environment tier.
        /// Dev -> devBaseUrl (default http://localhost:8080)
        /// Staging -> stagingBaseUrl (default Replit deployment)
        /// Production -> productionBaseUrl (default https://shanemccaw.com)
        /// </summary>
        public string GetBaseUrl(TargetEnvironment env) => env switch
        {
            TargetEnvironment.Dev => !string.IsNullOrWhiteSpace(DevBaseUrl) ? DevBaseUrl : (!string.IsNullOrWhiteSpace(ApiBaseUrl) && ApiBaseUrl.Contains("localhost") ? ApiBaseUrl : "http://localhost:8080"),
            TargetEnvironment.Staging => !string.IsNullOrWhiteSpace(StagingBaseUrl) ? StagingBaseUrl : (!string.IsNullOrWhiteSpace(ApiBaseUrl) ? ApiBaseUrl : "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/"),
            TargetEnvironment.Production => !string.IsNullOrWhiteSpace(ProductionBaseUrl) ? ProductionBaseUrl : "https://shanemccaw.com",
            _ => GetBaseUrl(TargetEnvironment.Dev)
        };

        /// <summary>
        /// Creates a copy of this config with ApiBaseUrl mapped to the target environment's specific base URL.
        /// </summary>
        public BuildTrackerConfig ForEnvironment(TargetEnvironment env)
        {
            return new BuildTrackerConfig
            {
                ApiBaseUrl = GetBaseUrl(env),
                IngestToken = this.IngestToken,
                MaxConcurrent = this.MaxConcurrent,
                DatabaseUrl = this.DatabaseUrl,
                DevBaseUrl = this.DevBaseUrl,
                StagingBaseUrl = this.StagingBaseUrl,
                ProductionBaseUrl = this.ProductionBaseUrl
            };
        }

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

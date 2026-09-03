using System;
using System.IO;
using System.Text.Json;

namespace ShaneBuilder.Services;

/// <summary>Git #2285 — read-only mirror of BuildConsole's own real concurrency cap
/// (<c>desktop/BuildConsole/Services/BuildTrackerConfig.cs</c>'s <c>MaxConcurrent</c>), sourced
/// from the SAME shared, gitignored <c>scripts/build-queue-watcher.config.json</c> file rather
/// than a second, drifting "8 slots" constant invented for this app. ShaneBuilder never writes
/// this file — BuildConsole's Settings UI (and <c>build-queue-watcher.ps1</c> itself) own that;
/// this is read-only, same convention as <see cref="QueueReadClient"/>'s read-only contract on
/// <c>bt_build_queue</c>. Falls back to the documented default of 8 (BuildTrackerConfig's own
/// default) when the file is missing, unreadable, or doesn't parse — never throws, never blocks
/// the slot-count summary on a config file that may not exist in every checkout.</summary>
public static class AgentSlotConfig
{
    public const int DefaultMaxConcurrent = 8;

    private sealed class ConfigShape
    {
        public int MaxConcurrent { get; set; } = DefaultMaxConcurrent;
    }

    /// <summary>Real <c>maxConcurrent</c> from <c>scripts/build-queue-watcher.config.json</c>,
    /// walking up from <paramref name="repoRoot"/> (falls back to the process base directory,
    /// mirroring BuildTrackerConfig.FindConfigPath's own walk) if the given root doesn't carry
    /// a <c>scripts/</c> folder directly. Clamped to a minimum of 1, same guard
    /// BuildConsole's own <c>QueueWatcherService.UpdateMaxConcurrent</c> applies, so a bad or
    /// zero value in the file can never render a nonsensical "X/0 slots".</summary>
    public static int LoadMaxConcurrent(string? repoRoot)
    {
        var path = FindConfigPath(repoRoot) ?? FindConfigPath(AppDomain.CurrentDomain.BaseDirectory);
        if (path == null) return DefaultMaxConcurrent;

        try
        {
            var json = File.ReadAllText(path);
            var cfg = JsonSerializer.Deserialize<ConfigShape>(
                json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return Math.Max(1, cfg?.MaxConcurrent ?? DefaultMaxConcurrent);
        }
        catch (Exception ex)
        {
            ConsoleOutputSink.Log(LogLevel.Warn, $"[slots] build-queue-watcher.config.json read failed, using default {DefaultMaxConcurrent}: {ex.Message}");
            return DefaultMaxConcurrent;
        }
    }

    private static string? FindConfigPath(string? start)
    {
        if (string.IsNullOrWhiteSpace(start)) return null;
        var dir = new DirectoryInfo(start);
        while (dir != null)
        {
            var candidate = Path.Combine(dir.FullName, "scripts", "build-queue-watcher.config.json");
            if (File.Exists(candidate)) return candidate;
            dir = dir.Parent;
        }
        return null;
    }
}

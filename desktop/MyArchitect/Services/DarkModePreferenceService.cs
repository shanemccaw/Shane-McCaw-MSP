using System;
using System.IO;
using System.Text.Json;

namespace MyArchitect.Services;

/// <summary>
/// Real local-file implementation of <see cref="IDarkModePreferenceService"/> — same JSON
/// persistence style already used by <see cref="ConsoleHistoryService"/>, applied here to the
/// portal dark-mode toggle preference under %LOCALAPPDATA%\MyArchitect\dark-mode-preference.json.
/// </summary>
public sealed class DarkModePreferenceService : IDarkModePreferenceService
{
    private readonly string _filePath;
    private readonly object _lock = new();
    private bool _isDarkModeEnabled;

    private sealed class PreferenceData
    {
        public bool IsDarkModeEnabled { get; set; } = true;
    }

    public DarkModePreferenceService(string? filePath = null)
    {
        _filePath = filePath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MyArchitect", "dark-mode-preference.json");

        _isDarkModeEnabled = LoadFromDisk(_filePath);
    }

    public bool IsDarkModeEnabled
    {
        get { lock (_lock) return _isDarkModeEnabled; }
    }

    public void SetDarkModeEnabled(bool enabled)
    {
        lock (_lock)
        {
            _isDarkModeEnabled = enabled;
            SaveToDisk();
        }
    }

    private static bool LoadFromDisk(string filePath)
    {
        try
        {
            // Never written yet — default on, per #4274's own scope.
            if (!File.Exists(filePath)) return true;
            var json = File.ReadAllText(filePath);
            var data = JsonSerializer.Deserialize<PreferenceData>(json);
            return data?.IsDarkModeEnabled ?? true;
        }
        catch
        {
            // Corrupt/unreadable preference file — default on rather than crash on launch.
            return true;
        }
    }

    private void SaveToDisk()
    {
        try
        {
            var dir = Path.GetDirectoryName(_filePath);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(
                new PreferenceData { IsDarkModeEnabled = _isDarkModeEnabled },
                new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_filePath, json);
        }
        catch
        {
            // Best-effort persistence — a save failure should not crash the toggle interaction.
        }
    }
}

using System;
using System.IO;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>
    /// Git #834 — Shane: "There is a settings menu item, and a settings cog
    /// bottom left corner. Use that to hold my PAT in app settings or
    /// something." Small writable local store — a JSON file under
    /// %AppData%\BuildConsole\, outside the repo (never committed to git,
    /// unlike scripts\build-queue-watcher.config.json which IS checked in and
    /// holds a different token for a different API).
    /// </summary>
    public class BuildConsoleSettings
    {
        public string GitHubPat { get; set; } = "";

        public bool HasGitHubPat => !string.IsNullOrWhiteSpace(GitHubPat);

        private static string SettingsDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole");

        private static string SettingsPath => Path.Combine(SettingsDir, "settings.json");

        public static BuildConsoleSettings Load()
        {
            try
            {
                if (!File.Exists(SettingsPath)) return new BuildConsoleSettings();
                var json = File.ReadAllText(SettingsPath);
                var settings = JsonSerializer.Deserialize<BuildConsoleSettings>(
                    json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                return settings ?? new BuildConsoleSettings();
            }
            catch
            {
                return new BuildConsoleSettings();
            }
        }

        public void Save()
        {
            Directory.CreateDirectory(SettingsDir);
            var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(SettingsPath, json);
        }
    }
}

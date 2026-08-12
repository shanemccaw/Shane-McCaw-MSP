using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace BuildConsole.Services
{
    /// <summary>Git #864 — one entry in the ActivityBar's "Web Tools" popout / Settings list.</summary>
    public class WebToolEntry
    {
        public string Name { get; set; } = "";
        public string Url { get; set; } = "";
        public string Icon { get; set; } = "";
    }

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

        /// <summary>Git #880 — Zoho API Token for the zohoTests runner to authenticate real Zoho API calls. Same store, same pattern as GitHubPat.</summary>
        public string ZohoApiToken { get; set; } = "";

        public bool HasZohoApiToken => !string.IsNullOrWhiteSpace(ZohoApiToken);

        // Git #864 — Shane: "I need you to design me a icon based popout panel
        // with web site tools like: LinkedIn, Google Analytics, Microsoft
        // Clarity... a configuration in the settings might actually be
        // better." Field initializer (not a ctor assignment) so a
        // pre-#864 settings.json — one with no "webTools" key at all —
        // still deserializes with these three defaults intact; only a
        // settings.json that HAS since been saved with an explicit (possibly
        // empty) list overrides it.
        public List<WebToolEntry> WebTools { get; set; } = new()
        {
            new WebToolEntry { Name = "LinkedIn", Url = "https://www.linkedin.com", Icon = "" },
            new WebToolEntry { Name = "Google Analytics", Url = "https://analytics.google.com", Icon = "" },
            new WebToolEntry { Name = "Microsoft Clarity", Url = "https://clarity.microsoft.com", Icon = "" },
        };

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

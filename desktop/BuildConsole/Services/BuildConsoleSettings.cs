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

        // ── Git #902 — Replit idle watcher (sub-issue of Epic #803) ──────────
        // Shane: "Replit shuts its dev mode down after like 10 minutes of
        // inactivity. So I always have to turn it back on after a build."
        // Same local store / same round-trip pattern as GitHubPat/ZohoApiToken
        // above; the field initializers double as sensible defaults for a
        // pre-#902 settings.json (a JSON with no "replit*" keys still
        // deserializes with these intact).

        /// <summary>Off by default: waking the Repl clicks Run on the Replit dashboard, which only works inside an authenticated Replit WebView2 session AND after Shane calibrates the Run-button selector for his live IDE — see ReplitRunButtonSelector. Shane flips this on once he's logged into the Replit tab and confirmed the selector.</summary>
        public bool ReplitWatcherEnabled { get; set; } = false;

        /// <summary>How often the background watcher polls the deployed app URL, in minutes. Task default is 3–5 min; 4 is the midpoint.</summary>
        public int ReplitWatcherIntervalMinutes { get; set; } = 4;

        /// <summary>The deployed app URL the watcher polls to decide up/down. Defaults to the same picard.replit.dev dev URL used throughout the app (ActivityBar QuickNav / Automation targets).</summary>
        public string ReplitAppUrl { get; set; } =
            "https://ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev/";

        /// <summary>The real Replit Workspace dashboard/IDE URL the watcher opens to click Run — same URL as ActivityBar.xaml's "Replit Workspace" QuickNav entry. Re-hitting the app URL alone does NOT wake a sleeping Repl (confirmed with Shane); you must land on the dashboard and click Run.</summary>
        public string ReplitWorkspaceUrl { get; set; } =
            "https://replit.com/@shanemccaw/Shane-McCaw-Consulting";

        /// <summary>CSS selector for the Replit "Run" button. This is a BEST-GUESS default — the real selector only exists inside Shane's authenticated Replit IDE session and cannot be determined from a sandboxed build, so it MUST be editable here without a rebuild. The watcher also falls back to any button/anchor whose visible text is exactly "Run", but Shane should calibrate this once he's landed on the live dashboard.</summary>
        public string ReplitRunButtonSelector { get; set; } = "[data-cy=\"ws-run-btn\"]";

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

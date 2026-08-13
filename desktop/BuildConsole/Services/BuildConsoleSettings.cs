using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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
    /// Git #953 (Epic #803) — one NAME=value pair in the Settings "Test Environment
    /// Variables" store. Shane sets TEST_PORTAL_PASSWORD and every other
    /// TEST_*/GRAPH_TEST_* placeholder here; a manifest run resolves {{Name}} against
    /// these before falling through to per-run extracted values, so the placeholders
    /// the session's manifests reference actually resolve instead of throwing
    /// VariableNotResolvedException. Same local store / round-trip pattern as WebTools.
    /// </summary>
    public class TestEnvVar
    {
        public string Name { get; set; } = "";
        public string Value { get; set; } = "";

        /// <summary>
        /// Git #961 (Epic #803) — true when this pair was auto-added by the manifest
        /// scanner (<see cref="TestManifestVariableScanner"/>) with a placeholder
        /// default, not set by Shane. Surfaced as an orange "NEEDS REVIEW" tag in
        /// Settings so he can fix the value in place instead of hunting through
        /// manifest files. Cleared automatically the moment he edits the value away
        /// from the auto-generated default (<see cref="TestManifestVariableScanner.AutoDefaultValue"/>).
        /// Field default is <c>false</c> so a pre-#961 settings.json (whose entries
        /// have no "needsReview" key) round-trips as "already reviewed", never
        /// spuriously flagging values Shane set before this existed.
        /// </summary>
        public bool NeedsReview { get; set; } = false;
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

        /// <summary>
        /// Git #922 (Epic #803) — the Claude "New chat project URL" a fresh
        /// epic chat is opened against when Shane right-clicks an epic that has
        /// no linked BoardChat yet. This is BuildConsole's OWN copy of the
        /// browser extension's <c>epicChatProjectUrl</c> (which lives in that
        /// extension's <c>chrome.storage.local</c>) — different storage system,
        /// same concept: BuildConsole's WebView2 tabs aren't real Chrome with
        /// the extension installed, so it can't read that value and Shane sets
        /// it once here too. Empty by default; the right-click "New Epic Chat"
        /// item opens this URL carrying the <c>{PAT}\r\nEpic #N</c> prefill as a
        /// <c>?bt_prefill=</c> query param. Same local store / round-trip
        /// pattern as GitHubPat/ZohoApiToken above.
        /// </summary>
        public string EpicChatProjectUrl { get; set; } = "";

        public bool HasEpicChatProjectUrl => !string.IsNullOrWhiteSpace(EpicChatProjectUrl);

        // ── Git #937 (Epic #803) — always-on-top Sticky Notes floaty ──────────
        // Shane: "a floaty sticky notes... take notes for... Then I should be
        // able to send what I note down into a Claude chat that I'm typing into
        // now." Same local store / round-trip pattern as GitHubPat above. The
        // note text is auto-saved (debounced) as Shane types so an accidental
        // close never loses anything; the window's last position/size are
        // remembered so it reopens exactly where he left it. Left/Top default to
        // -1 as a "never positioned yet" sentinel (System.Text.Json can't round-
        // trip double.NaN by default, so -1 stands in for "center on first
        // open"); Width/Height carry real defaults.

        /// <summary>The Sticky Notes floaty's current text, auto-saved (debounced) as Shane types so a stray close can't lose it.</summary>
        public string StickyNotesText { get; set; } = "";

        /// <summary>Last on-screen X of the Sticky Notes floaty. -1 = never positioned yet (center on first open).</summary>
        public double StickyNotesLeft { get; set; } = -1;

        /// <summary>Last on-screen Y of the Sticky Notes floaty. -1 = never positioned yet (center on first open).</summary>
        public double StickyNotesTop { get; set; } = -1;

        /// <summary>Last width of the Sticky Notes floaty.</summary>
        public double StickyNotesWidth { get; set; } = 300;

        /// <summary>Last height of the Sticky Notes floaty.</summary>
        public double StickyNotesHeight { get; set; } = 340;

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

        // ── Git #973 — LinkedIn post pre-fill via WebView2 (NOT Epic #803) ────
        // Shane: "Can we use the WebView2 DOM to auto-schedule LinkedIn posts...
        // I was more thinking a pre-fill and then I'd press the actual schedule
        // button." Pre-fill ONLY — the LinkedIn composer floaty (#937 shape)
        // injects the post text into LinkedIn's real compose box; Shane presses
        // Schedule/Post himself. Same local %AppData%\BuildConsole\settings.json
        // store / round-trip pattern as every field above; the initializers
        // double as defaults for a pre-#973 settings.json.

        /// <summary>
        /// CSS selector for LinkedIn's real post-composer element. This is a
        /// BEST-GUESS default (LinkedIn's share box is a Quill contenteditable
        /// div) — the exact live-authenticated DOM can't be inspected from a
        /// sandboxed build, so it MUST be editable here without a rebuild and
        /// calibrated against Shane's real LinkedIn session, exactly like #902's
        /// ReplitRunButtonSelector. If it matches no element the floaty shows a
        /// clear recalibrate message rather than failing silently.
        /// </summary>
        public string LinkedInComposerSelector { get; set; } = "div.ql-editor[contenteditable=\"true\"]";

        /// <summary>The LinkedIn URL the "Send to LinkedIn" action opens/focuses when no LinkedIn tab is already open. Defaults to the feed, where the "Start a post" composer lives.</summary>
        public string LinkedInComposeUrl { get; set; } = "https://www.linkedin.com/feed/";

        /// <summary>The LinkedIn composer floaty's current draft text, auto-saved (debounced) as Shane types so a stray close can't lose it (same as StickyNotesText).</summary>
        public string LinkedInComposerText { get; set; } = "";

        /// <summary>Last on-screen X of the LinkedIn composer floaty. -1 = never positioned yet (center on first open).</summary>
        public double LinkedInComposerLeft { get; set; } = -1;

        /// <summary>Last on-screen Y of the LinkedIn composer floaty. -1 = never positioned yet (center on first open).</summary>
        public double LinkedInComposerTop { get; set; } = -1;

        /// <summary>Last width of the LinkedIn composer floaty.</summary>
        public double LinkedInComposerWidth { get; set; } = 340;

        /// <summary>Last height of the LinkedIn composer floaty.</summary>
        public double LinkedInComposerHeight { get; set; } = 380;

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
            new WebToolEntry { Name = "Git", Url = "https://github.com/shanemccaw/Shane-McCaw-MSP", Icon = "\uE71B" },
        };

        // Git #953 (Epic #803) — Shane: "How do I set things like TEST_PORTAL_PASSWORD?"
        // The manifest runner resolves {{NAME}} placeholders against these stored pairs
        // BEFORE falling through to TestRunVariables' per-run extracted values — the same
        // precedence {{DEPLOY_URL}}/{{SECRET_KEY}} already have. Field initializer (empty
        // list, not a ctor assignment) so a pre-#953 settings.json — one with no
        // "testEnvironmentVariables" key — still deserializes cleanly. DEPLOY_URL/SECRET_KEY
        // are NOT stored here; they keep resolving from build-queue-watcher.config.json
        // exactly as before (HttpTestExecutor.ResolvePlaceholders), so this store never
        // needs to hold them.
        public List<TestEnvVar> TestEnvironmentVariables { get; set; } = new();

        // ── Git #967 (Epic #803) — scheduled recurring regression-suite runs ──────
        // A background DispatcherTimer (RegressionScheduleService) sweeps the full
        // _regression-suite.json every N hours and, ONLY on failure, fires an admin
        // web-push alert via the api-server (sendWebPushToAdmins, the #727 pattern). Same
        // local %AppData%\BuildConsole\settings.json store and field-initializer-as-default
        // convention as the Replit watcher above, so a pre-#967 settings.json still
        // deserializes cleanly (no "scheduled*" keys → these defaults intact). Off by
        // default — Shane arms it from Settings > Test Environment when he wants unattended
        // runs (e.g. before a heavy day of site work, per #967).

        /// <summary>Off by default: when on, the full regression suite runs unattended every ScheduledRegressionIntervalHours.</summary>
        public bool ScheduledRegressionEnabled { get; set; } = false;

        /// <summary>How often the background scheduler runs the full _regression-suite.json sweep, in hours. Default 24 (once a day). Minimum enforced at 1.</summary>
        public int ScheduledRegressionIntervalHours { get; set; } = 24;

        /// <summary>When a scheduled run has any failing manifest/step, POST an admin web-push alert (server-side sendWebPushToAdmins, #727) naming the failure. A fully passing run is always silent regardless. On by default so an armed scheduler is actually actionable.</summary>
        public bool PushOnRegressionFailure { get; set; } = true;

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
                settings ??= new BuildConsoleSettings();

                // Web Tools popout: add Git repo as a default entry — the WebTools field
                // initializer above only seeds the Git entry for a settings.json with no
                // "webTools" key at all. An existing install (Shane already has the original
                // three #864 defaults saved) deserializes its own explicit list here, which
                // has no Git entry and never will on its own. Backfill it once, in place, so
                // it shows up without Shane needing to add it by hand.
                if (settings.WebTools != null &&
                    settings.WebTools.Count > 0 &&
                    !settings.WebTools.Any(t => string.Equals(t.Url, "https://github.com/shanemccaw/Shane-McCaw-MSP", StringComparison.OrdinalIgnoreCase)))
                {
                    settings.WebTools.Add(new WebToolEntry
                    {
                        Name = "Git",
                        Url = "https://github.com/shanemccaw/Shane-McCaw-MSP",
                        Icon = ""
                    });
                    settings.Save();
                }

                return settings;
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

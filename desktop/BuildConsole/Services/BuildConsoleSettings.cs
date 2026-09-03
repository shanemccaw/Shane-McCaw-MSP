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

    /// <summary>Represents a user account/credential profile for local instance gating/auth tests.</summary>
    public class UserAccountEntry
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Username { get; set; } = "";
        public string Password { get; set; } = "";
        public string AccountTier { get; set; } = "Standard"; // Standard, Premium, Enterprise, Admin
        public string Notes { get; set; } = "";
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
    /// Git #874 Home screen — one open chat tab remembered across restarts so the
    /// Home view's "Where you left off" roll-up can offer to reopen it. Captures
    /// the real BoardChat identity (ConversationId/Title/ClaudeUrl/EpicId/
    /// IssueGithubNumber) the app already opens chats by (see MainWindow.OpenChatTab
    /// / BoardChat) plus which of the four editor panes it was living in, so the
    /// per-pane layout is remembered too. Git #1887 — the NEXT session's launch now
    /// background-reopens each of these automatically (see MainWindow.ChatReopen.cs),
    /// in addition to the Home "Where you left off" roll-up still referencing this
    /// same snapshot for its manual click-to-focus list. Same %AppData%\BuildConsole\settings.json store / round-trip as
    /// every field below; a pre-#874 settings.json (no "openChatTabs" key) still
    /// deserializes with the empty-list field initializer intact.
    /// </summary>
    public class PersistedChatTab
    {
        public string ConversationId { get; set; } = "";
        public string Title { get; set; } = "";
        public string ClaudeUrl { get; set; } = "";
        public int? EpicId { get; set; }
        public int? IssueGithubNumber { get; set; }
        /// <summary>Which editor pane (0 = primary EditorTabs, 1 = EditorTabs2, 2 = EditorTabs3, 3 = EditorTabs4) this chat tab was in when last persisted.</summary>
        public int PaneIndex { get; set; }
        /// <summary>When this snapshot was written — surfaced as the "left off" subtitle.</summary>
        public DateTime SavedAt { get; set; }
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
        // ── Git #874 Home screen — open chat tabs remembered across restarts ──
        // Rewritten in full every time a chat tab opens/closes or is dragged
        // between panes (MainWindow.PersistOpenChatTabs); the Home view's
        // "Where you left off" section reads the snapshot captured AT LAUNCH so
        // it always shows where the LAST session left off, not this one's live
        // state. Empty-list field initializer so a pre-#874 settings.json
        // (no "openChatTabs" key) still deserializes cleanly.
        public List<PersistedChatTab> OpenChatTabs { get; set; } = new();

        // ── Gated User Accounts for testing and automation ──
        public List<UserAccountEntry> UserAccounts { get; set; } = new();
        public string ActiveUserAccountId { get; set; } = "";

        // ── "What's New" Home patch-notes (reuses the #992/version build number) ──
        // The Home screen shows a short, video-game-patch-notes-style bullet list of
        // the real commit titles that have landed for BuildConsole since Shane last
        // launched. This is the ONLY new state it needs: the build number of the last
        // launch we already showed him. It reuses the SAME real build-number value the
        // version-tracking feature computes (VersionInfo.RunningBuild — the git commit
        // count for desktop/BuildConsole baked into this assembly); no second
        // versioning system is introduced. -1 is a "never launched before" sentinel:
        // on the very first launch we seed it to the current build silently rather than
        // dumping the entire history as "new". A pre-existing settings.json (no
        // "lastSeenBuild" key) deserializes with this -1 intact, so an existing install
        // also just seeds a baseline on its first post-update launch instead of
        // replaying every commit.
        public int LastSeenBuild { get; set; } = -1;

        // ── Git Board manifest tree — "new manifest" tracking ────────────────
        // Shane: "anytime a new test manifest is added, even if it's been ran
        // by the agent... I need it bold so I can easily find it." Same
        // bootstrap-sentinel shape as LastSeenBuild above: on the very first
        // scan after this field ships, ManifestTrackingBootstrapped is false,
        // so every manifest that already exists gets silently seeded into
        // SeenManifestPaths WITHOUT being flagged new (an existing install's
        // entire corpus shouldn't suddenly light up bold). From then on, a
        // manifest path not yet in SeenManifestPaths is "new"; it's added to
        // the set (persisted) the moment Shane actually opens it in the tree
        // (LeftSidebar.LoadManifestLeaf) — NOT when an agent runs it, so a
        // just-added-and-already-run manifest still reads as new until Shane
        // himself looks at it.
        public bool ManifestTrackingBootstrapped { get; set; } = false;
        public List<string> SeenManifestPaths { get; set; } = new();

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

        // ── Direct SSH / Remote Replit Execution ──────────────────────────────
        public string SshKeyPath { get; set; } = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".ssh", "replit");
        public string SshHost { get; set; } = "ba888680-2595-412d-84fe-4e9aefc2688b-00-22rhgh0krunr4.picard.replit.dev";
        public string SshUser { get; set; } = "ba888680-2595-412d-84fe-4e9aefc2688b";
        public int SshPort { get; set; } = 22;
        public string SshRemoteDir { get; set; } = "/home/runner/workspace";
        public bool UseSshForDeploy { get; set; } = true;
        public bool UseSshForSql { get; set; } = true;

        public bool HasSshConfig => !string.IsNullOrWhiteSpace(SshKeyPath) && !string.IsNullOrWhiteSpace(SshHost);

        /// <summary>
        /// Git #1639 — the unsolicited "Way to go! 🎯 ... Get some ice cream! 🍦" Encouragement
        /// critter (<see cref="EncouragementService"/>) fired unconditionally every random
        /// 12-24 minutes with no way to turn it off. Default <c>false</c>: MainWindow only calls
        /// <c>EncouragementService.Instance.Start()</c> when this is true, so a fresh/existing
        /// settings.json (no "encouragementCrittersEnabled" key) opts OUT of the automatic timer
        /// by default. Separate from the manual "Cheer Me Up" menu item (TriggerCheerNow), which
        /// always works regardless of this setting.
        /// </summary>
        public bool EncouragementCrittersEnabled { get; set; } = false;

        // ── Git #1416 — multi-account routing for Claude Code (overflow to secondary) ──
        // Shane runs a primary Max 20x account and a secondary Pro account as SEQUENTIAL
        // overflow (never concurrent). A queue build carries an Account of "primary"
        // (default) or "secondary"; when secondary, QueueWatcherService.LaunchItem launches
        // claude.exe with CLAUDE_CONFIG_DIR pointed at this secondary path instead of the
        // default (~/.claude) config dir, so the overflow build authenticates as the second
        // account without Shane ever switching config dirs at the terminal. No automatic
        // failover — Shane picks primary/secondary per job (the queue UI's account selector,
        // or the `--account secondary` build-prompt header flag). A leading `~` is expanded
        // to the user profile at launch. Same %AppData%\BuildConsole\settings.json store /
        // field-initializer-as-default convention as every field above; a pre-#1416
        // settings.json (no "secondaryClaudeConfigDir" key) deserializes with this default
        // intact, and a build with no/blank/"primary" Account always uses the default config
        // dir exactly as before.

        /// <summary>Git #1416 — the CLAUDE_CONFIG_DIR a "secondary"-account queue build is launched against (Shane's overflow Pro account). Defaults to ~/.claude-secondary. A leading ~ is expanded at launch. Primary-account builds are unaffected — they use the default (~/.claude) config dir.</summary>
        public string SecondaryClaudeConfigDir { get; set; } =
            System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude-secondary");

        /// <summary>Git #1419 — the global default account ("primary" or "secondary") applied to any
        /// newly queued build that doesn't already carry an explicit `--account` header flag or an
        /// Edit Build Prompt dialog override. Set via the title-bar Primary/Secondary toggle so Shane
        /// can route a whole overflow session to the secondary account without opening the dialog for
        /// every build. The per-build Account selector (#1416) always wins when it's explicitly set.</summary>
        public string DefaultAccount { get; set; } = "primary";

        /// <summary>Git #1480 — the title-bar toggle's current value, normalized to a concrete
        /// "primary"/"secondary" label (never null/blank). Used to stamp bt_chats.account on
        /// newly-created chats and to scope the Chats panel / In Progress list. Unlike
        /// <see cref="DefaultAccount"/>'s raw stored string (and unlike bt_build_queue.account,
        /// which uses NULL to mean primary), bt_chats.account is NOT NULL — every caller needs
        /// a real literal value, not null-means-primary.</summary>
        public static string CurrentAccountLabel() =>
            string.Equals(Load().DefaultAccount, "secondary", StringComparison.OrdinalIgnoreCase)
                ? "secondary"
                : "primary";

        // ── Git #1986 — Home/Rental location switch (gate metered network ops) ──────
        // Shane splits time between a fibre "Home" connection (bandwidth a non-issue)
        // and a capped Verizon "Rental" connection where a large download is a real,
        // metered cost. This is a MANUAL, explicit, persisted switch — NEVER auto-
        // detected (a wrong guess that silently enabled heavy downloads on the capped
        // line is exactly the failure being prevented). Same field-initializer-as-
        // default / %AppData%\BuildConsole\settings.json convention as DefaultAccount
        // above. The default is "Home" (unmetered) in EVERY ambiguous case — a missing
        // key, and a corrupt settings.json (Load()'s catch returns a fresh instance) —
        // so the app never silently starts throttling. Only "Rental" (case-insensitive)
        // is treated as metered; anything else, including blank/garbage, reads as Home.
        //
        // The gate this drives: BUILD_NETWORK=metered|unmetered injected into every
        // launched build (QueueWatcherService.LaunchItem), the `--network` header flag,
        // the .pnpmfile.cjs metered-install refusal at the repo root, and the one-shot
        // per-operation override on the version-update deploy. The override is a UI
        // action only and NEVER flips this field — see MainWindow's metered-override
        // handling. There is deliberately no env var / settings key / build-prompt flag
        // an agent can set to grant itself an exception.

        /// <summary>Git #1986 — the persisted location: "Home" (fibre, unmetered) or "Rental" (capped Verizon, metered). Default "Home". Never auto-detected. Only "Rental" (case-insensitive) means metered; every other value, including a missing/corrupt setting, reads as Home so the app never silently throttles.</summary>
        public string LocationMode { get; set; } = "Home";

        /// <summary>True when the persisted <see cref="LocationMode"/> is "Rental" (the capped, metered connection). Every ambiguous case (blank, unknown value, missing/corrupt settings.json) returns false — Home/unmetered — so the app never silently starts throttling.</summary>
        public static bool CurrentNetworkIsMetered() =>
            string.Equals(Load().LocationMode, "Rental", StringComparison.OrdinalIgnoreCase);

        /// <summary>Git #1986 — the value BuildConsole injects as BUILD_NETWORK into every launched build: "metered" when Rental, else "unmetered".</summary>
        public static string CurrentNetworkLabel() =>
            CurrentNetworkIsMetered() ? "metered" : "unmetered";

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

        // ── Git #1472 — Visual Test Tracker floaty (separate from Sticky Notes) ──
        // A NEW standalone panel — StickyNotesWindow stays exactly as-is, untouched.
        // Watches WebView2 navigation against a configurable list of base URLs
        // (not hardcoded to portal-v2), so adding e.g. the marketing site's dev URL
        // later is a config entry, not new code. Same -1-sentinel bounds pattern as
        // Sticky Notes / Build Watch above.

        /// <summary>Base URLs the Visual Test Tracker watches navigation against (substring match against
        /// the WebView2's Source host+path) — e.g. "localhost:5175/portal/shane-mccaw-consulting/portal-v2".
        /// Defaults to that one entry; add more here (or via Settings, once exposed) for other dev apps.</summary>
        public List<string> VisualTestTrackerBaseUrls { get; set; } = new()
        {
            "localhost:5175/portal/shane-mccaw-consulting/portal-v2"
        };

        /// <summary>Last on-screen X of the Visual Test Tracker window. -1 = never positioned yet (center on first open).</summary>
        public double VisualTestTrackerLeft { get; set; } = -1;

        /// <summary>Last on-screen Y of the Visual Test Tracker window. -1 = never positioned yet (center on first open).</summary>
        public double VisualTestTrackerTop { get; set; } = -1;

        /// <summary>Last width of the Visual Test Tracker window.</summary>
        public double VisualTestTrackerWidth { get; set; } = 380;

        /// <summary>Last height of the Visual Test Tracker window.</summary>
        public double VisualTestTrackerHeight { get; set; } = 560;

        // ── Git #980 — floaty Build Watch panel window bounds ────────────────
        // Shane: "put it off to another monitor and watch as it progresses."
        // Same local %AppData%\BuildConsole\settings.json store / round-trip
        // pattern as the Sticky Notes floaty above; Left/Top use -1 as the
        // "never positioned yet" sentinel (center on first open), Width/Height
        // carry real defaults. A pre-#980 settings.json (no "buildWatch*" keys)
        // still deserializes with these intact.

        /// <summary>Last on-screen X of the Build Watch window. -1 = never positioned yet (center on first open).</summary>
        public double BuildWatchLeft { get; set; } = -1;

        /// <summary>Last on-screen Y of the Build Watch window. -1 = never positioned yet (center on first open).</summary>
        public double BuildWatchTop { get; set; } = -1;

        /// <summary>Last width of the Build Watch window.</summary>
        public double BuildWatchWidth { get; set; } = 900;

        /// <summary>Last height of the Build Watch window.</summary>
        public double BuildWatchHeight { get; set; } = 560;

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

        // ── Git #2059 — Floating Chat Window (Phase 1 of the #2035 Global Chat
        // Drawer epic). Position/size of the always-on-top single-chat floaty,
        // persisted the same debounced %AppData% round-trip as the LinkedIn /
        // Sticky Notes floaties above so a stray close/reopen lands where Shane
        // left it. -1 sentinels = never positioned yet (center on first open).
        /// <summary>Last on-screen X of the floating chat window. -1 = never positioned yet (center on first open).</summary>
        public double FloatingChatLeft { get; set; } = -1;

        /// <summary>Last on-screen Y of the floating chat window. -1 = never positioned yet (center on first open).</summary>
        public double FloatingChatTop { get; set; } = -1;

        /// <summary>Last width of the floating chat window.</summary>
        public double FloatingChatWidth { get; set; } = 380;

        /// <summary>Last height of the floating chat window.</summary>
        public double FloatingChatHeight { get; set; } = 500;

        /// <summary>Whether the floating chat window's live bridge strip was expanded when last closed. Collapsed pauses real-time capture (WebView2 throttles when hidden), so it defaults expanded.</summary>
        public bool FloatingChatBridgeExpanded { get; set; } = true;

        /// <summary>Git #2195 — whether the side dock (synthesized pending-items relationship map)
        /// was expanded when last closed. Defaults OFF: it's a new panel that widens the window, so
        /// it starts hidden until Shane opts in via the header toggle, same as most first-run panels
        /// in this app.</summary>
        public bool FloatingChatDockExpanded { get; set; } = false;

        /// <summary>
        /// Git #2105 — active pinned-question detection. When on, each open floating-chat tab, on
        /// every settled assistant turn (the real "turn completed" event, not polling), is probed
        /// once — a real message asking whether it is waiting on anything from Shane — and each
        /// distinct question in the reply is persisted as its own <c>chat_pinned_questions</c> row.
        /// Defaults OFF: it sends real messages into real conversations (consuming Claude usage and
        /// appearing in the transcript), so it's opt-in — flip this in %AppData%\BuildConsole\settings.json.
        /// A per-chat cooldown and a "never re-probe the probe's own answer" gate keep it from
        /// looping or spamming; see FloatingChatWindow's MaybeProbeForPinnedQuestionsAsync.
        /// </summary>
        public bool PinnedQuestionDetectionEnabled { get; set; } = false;

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

        // ── Post-Build Auto Test Verification ─────────────────────────────
        /// <summary>When on, automatically runs the matching test manifest for a completed build's issue
        /// after deploy confirmation. DEFAULT FLIPPED TO false (2026-08-23): the product now runs locally
        /// (Dev) for day-to-day agent work and Staging (Replit) is a deliberate, Shane-only manual deploy
        /// (see StagingDeployService / the "Deploy to Staging" button) — nothing should auto-trigger tests
        /// against the remote any more. Shane runs tests himself after a manual Staging deploy. Existing
        /// settings.json files that set this true keep their value; flip it off there to match the new scope.</summary>
        public bool AutoRunTestsOnBuildComplete { get; set; } = false;

        /// <summary>Off by default: if a completed build has no specific matching issue manifest, should it fallback to running the entire full regression suite? (False = skip tests if no matching issue manifest).</summary>
        public bool AutoRunFullSuiteFallbackOnBuildComplete { get; set; } = false;

        // ── Build completion sound ────────────────────────────────────────
        // Plays when a queue-managed build genuinely finishes (QueueWatcherService
        // TickAsync sees the process exit and reports completion). The mute
        // toggle lives in the top menu bar ("_Sound" > "Mute Completion Sound");
        // the event itself still fires/logs normally when muted — only
        // BuildCompletionSoundService's playback is suppressed. Same local
        // %AppData%\BuildConsole\settings.json store / round-trip pattern as
        // every field above.

        /// <summary>Off by default (sound plays). When on, BuildCompletionSoundService.Play is a no-op — the completion event/log still fires.</summary>
        public bool BuildCompleteSoundMuted { get; set; } = false;

        /// <summary>Absolute path to a custom completion sound file. Empty (the default) means "use the bundled Assets\Sounds\taskCompleted.mp3 that ships alongside the app".</summary>
        public string BuildCompleteSoundPath { get; set; } = "";

        // ── Interactive queue-managed builds ─────────────────────────────────
        // Change how the in-app QueueWatcherService launches queued builds:
        // BuildConsole owns their redirected stdin/stdout (claude.exe
        // --input-format stream-json --output-format stream-json --print), so a
        // Build Watch slot can type real input into the running process's stdin,
        // soft-interrupt it, and see when it's genuinely waiting on input. When
        // OFF, queue builds fall back to the legacy Git #800 path (--print with
        // the prompt as a positional arg, stdout→log file only, no stdin) — a
        // safety valve if the interactive path ever misbehaves, flippable without
        // a rebuild by editing settings.json. Send-to-Builder sessions (#1001)
        // are never affected either way. Same %AppData%\BuildConsole\settings.json
        // store / field-initializer-as-default convention as every field above.

        /// <summary>On by default: queue builds launch with BuildConsole-owned redirected stdin/stdout so Build Watch can chat into them. Off = legacy --print positional-prompt path (no stdin, no interactivity).</summary>
        public bool InteractiveBuilds { get; set; } = true;

        /// <summary>Git #1371 — On by default: every launched build runs in its OWN isolated git
        /// worktree (provisioned off origin/main, node_modules junctioned/shared per #1372) instead
        /// of the shared repo checkout, so concurrent sessions can never collide over the working
        /// tree/index. Off = legacy behavior (all builds share the repo checkout — collision-prone).
        /// A build queued with an explicit --cwd header still honors that path and skips isolation.</summary>
        public bool EnforceWorktreeIsolation { get; set; } = true;

        /// <summary>Global queue paused state, remembered across app restarts.</summary>
        public bool QueuePaused { get; set; } = false;

        /// <summary>Git #2771 — Git Board tree's "Hide Completed" toggle: when on, a top-level Epic
        /// whose real transitive leaf-issue rollup (<see cref="GitBoardIssueFilters.ComputeTransitiveLeafRollup"/>,
        /// #2739) is 100% closed is skipped from the tree entirely, along with its whole subtree.
        /// Independent of (composes with) <c>_currentFilter</c>'s mutually-exclusive chip. Persisted
        /// across sessions, same convention as the other UI-toggle bools in this file.</summary>
        public bool HideCompletedEpics { get; set; } = false;

        /// <summary>
        /// Git #2130 — KILL SWITCH for #1887's background chat-tab auto-reopen preload
        /// (<c>MainWindow.ReopenPersistedChatTabsInBackgroundAsync</c> /
        /// <c>ChatReopenPreloadHost</c>). OFF by default (and for any settings.json written
        /// before this field existed — a missing key deserializes to false here) after that
        /// feature was found to lock up Shane's machine and drain the build queue on a real
        /// cold start with several tabs persisted. When false, the whole background-preload
        /// path no-ops cleanly at its entry point; manual tab-reopen-on-click (the existing
        /// Home-screen "Resume Chat" path) is unaffected and keeps working. Set true only to
        /// re-enable the preload once its startup-contention root cause is fixed.
        /// The env var <c>BUILDCONSOLE_ENABLE_CHAT_REOPEN_PRELOAD=1</c> can force it on for a
        /// single run without editing settings.json.
        /// </summary>
        public bool EnableChatReopenPreload { get; set; } = false;

        /// <summary>
        /// Git #1989 — Conservation Cap toggle, title bar. OFF by default (and for any
        /// pre-existing settings.json written before this field existed — missing JSON
        /// keys deserialize to the C# default here, which is false/off) — a session that
        /// upgrades BuildConsole never silently starts capping builds it wasn't asked to.
        /// When ON, QueueWatcherService.LaunchItem parks (never launches) any queue item
        /// whose model/effort exceeds Sonnet High (AccountCapPolicy.ExceedsSonnetHigh) —
        /// status AccountCapPolicy.CappedStatus — instead of running it. A forced launch
        /// (Run Now / the per-item "Run at Full Model" override) always bypasses this,
        /// same as every other manual override in the queue. Turning this off, or
        /// draining, releases every currently-capped row back to 'queued' at its
        /// original model/effort — nothing is ever substituted.
        /// </summary>
        public bool ConservationModeEnabled { get; set; } = false;

        // ── Git #2003 — drive Conservation + account routing from the usage meter ─────
        // Shane: "If that [usage meter] was accurate ... I would use that as the indicator
        // basis and not have to click any buttons." These three fields turn the #1989
        // Conservation Cap and the #1416/#1419 account routing from purely-manual toggles
        // into meter-driven automation. ALL default to a safe, non-acting state so an
        // upgrade never silently starts capping or re-routing builds Shane didn't ask it
        // to: the master switch is OFF, and when it's on the automation still FAILS CLOSED
        // on any unavailable/errored/stale reading (see UsageAutomationService). Same
        // %AppData%\BuildConsole\settings.json store / field-initializer-as-default
        // convention as every field above; a pre-#2003 settings.json (no key) deserializes
        // with these defaults intact.

        /// <summary>Git #2003 — master switch for meter-driven automation (auto-conservation +
        /// headroom-aware account routing). OFF by default: the whole feature is opt-in, and while
        /// OFF the Conservation toggle and account routing behave exactly as the manual #1989/#1419
        /// controls did before. This is also the manual escape hatch — turning it off hands full
        /// manual control back. When ON, automation is still only a default: it never acts on a
        /// bad/stale reading, and a manual Conservation toggle wins for a visible window
        /// (UsageAutomationService.ManualHoldWindow).</summary>
        public bool UsageAutomationEnabled { get; set; } = false;

        /// <summary>Git #2003 — weekly-usage percent at/above which auto-conservation ENGAGES the
        /// #1989 cap for the account with the least headroom that a heavy build would still land on.
        /// Default 85 (Shane's stated "Conservation auto starts at 85%"). Configurable. A value
        /// outside 1..100 read from settings.json is clamped by UsageAutomationService rather than
        /// disabling the feature.</summary>
        public int AutoConservationThresholdPercent { get; set; } = 85;

        /// <summary>Git #2003 — weekly-usage percent at/below which an ENGAGED auto-conservation cap
        /// RELEASES. Deliberately well below <see cref="AutoConservationThresholdPercent"/> to provide
        /// the required hysteresis: engaging at 85 and releasing at 85 would flap across a poll
        /// boundary, so release only on a genuine reset (usage falling this far only happens when the
        /// weekly window rolls over) or when the tracked reset moment passes. Default 50.</summary>
        public int AutoConservationReleasePercent { get; set; } = 50;

        /// <summary>
        /// Git #1870 — Batter Up "Free flow" gate. This is a DIFFERENT gate from
        /// <see cref="QueuePaused"/>: QueuePaused stops rows LAUNCHING out of bt_build_queue;
        /// this stops board rows ENTERING it. When ON, BatterUpPanel auto-queues every eligible
        /// Batter Up board item on each refresh (the pre-#1870 behaviour). When OFF (the DEFAULT),
        /// the panel only LISTS the board and Shane queues rows one at a time by hand — nothing is
        /// auto-queued, ever. DEFAULT OFF is deliberate and load-bearing: #1870 exists because 45
        /// items entered the queue unasked, so a restart must never silently resume auto-queueing.
        /// BatterUpPanel.RefreshAsync reads this LIVE every tick, so toggling takes effect on the
        /// next refresh without a restart. A pre-#1870 settings.json (no "batterUpFreeFlow" key)
        /// deserializes with this false default intact — i.e. an existing install lands gated.
        /// </summary>
        public bool BatterUpFreeFlow { get; set; } = false;

        /// <summary>IDs of build queue items that have been paused by the user.</summary>
        public List<int> PausedBuildIds { get; set; } = new List<int>();

        /// <summary>Session-limit auto-restart — when a build's output shows the CLI's
        /// "hit your session limit · resets …" message, park it limit-paused and
        /// automatically re-queue it after the parsed reset + the delay below.
        /// See SessionLimitAutoRestartService. Off = limit-paused builds wait for a manual resume.</summary>
        public bool SessionLimitAutoRestartEnabled { get; set; } = true;

        /// <summary>Minutes AFTER the parsed session-limit reset moment to wait before auto-restarting (Shane: "10 minutes after the reset").</summary>
        public int SessionLimitAutoRestartDelayMinutes { get; set; } = 1;

        /// <summary>The armed auto-restart moment (local time, ISO-8601 round-trip), persisted so an app restart re-arms it. Empty = nothing armed.</summary>
        public string SessionLimitRestartAtIso { get; set; } = "";

        /// <summary>The parsed session-limit reset moment (local time, ISO-8601 round-trip), persisted so an app restart knows the reset moment. Empty = nothing armed.</summary>
        public string SessionLimitResetAtIso { get; set; } = "";

        /// <summary>One-shot: true once the first-set bootstrap (Git #1446/#1439/#1441/#1442/#1452/#1444, capped until 2:40am ET) has run. Never reset by the app.</summary>
        public bool SessionLimitFirstSetBootstrapDone { get; set; } = false;

        /// <summary>
        /// Git #800 must still hold: an interactive queue build must still auto-complete so the queue/concurrency
        /// slot frees and completion (sound, DB row) fires. After a turn finishes (a stream-json "result") the build
        /// sits WaitingForInput; if no further input arrives within this many seconds, BuildConsole closes its stdin
        /// so the CLI hits EOF and exits with a real code (exactly like the old one-shot --print). Each sent message
        /// resets the window, so an active back-and-forth stays alive. Default 15s. Set 0 to keep a build alive
        /// indefinitely until Dismiss/Stop (power-user; unattended builds will then hold their slot until finalized).
        /// </summary>
        public int InteractiveIdleFinalizeSeconds { get; set; } = 15;

        // ── Epic #803 — auto deploy+verify+test on build completion ───────────────
        // When a queue-managed build finishes SUCCESSFULLY, BuildConsole automatically runs the
        // deploy+verify+test pipeline that trigger-deploy-and-wait.ps1 used to require running by
        // hand: POST /api/admin/deploy/build-complete (#911 — git pull --ff-only + kill 1 restart)
        // -> poll GET /api/internal/deploy-status (#805) until the live commit hash flips (returning
        // the real new live hash, not just a boolean) -> run the full regression suite -> surface the
        // result via toast + the "Needs Attention" section. On by default so it's genuinely
        // automatic; flip to false here to fall back to the manual .ps1 + manual test flow. Same
        // local %AppData%\BuildConsole\settings.json store / field-initializer-as-default convention
        // as every field above — a pre-existing settings.json (no "autoDeployOnBuildComplete" key)
        // deserializes as true.

        /// <summary>A successfully finished queue build auto-triggers the real deploy (#911 git pull + restart),
        /// waits for #805 to confirm the new commit hash is live, then runs the regression suite. DEFAULT
        /// FLIPPED TO false (2026-08-23): the product now runs locally (Dev) for day-to-day agent work and
        /// Replit (Staging) is no longer something an agent/build/timer should ever wake or deploy to
        /// automatically. Staging is now a single, deliberate, Shane-only manual action — the "Deploy to
        /// Staging" button (StagingDeployService), which does the same SSH pull → #911 migrations+restart →
        /// #805 confirm → toast chain on demand. Off = no automatic deploy/test on build completion. An
        /// existing settings.json that set this true keeps its value; flip it off there to match the new scope.</summary>
        public bool AutoDeployOnBuildComplete { get; set; } = false;

        // ── UI-step DOM poll tuning (UiTestExecutor) ──────────────────────────────
        // A uiStep's `expect`/click/input actions poll the live DOM every
        // UiStepPollIntervalMs across a bounded UiStepPollTimeoutMs window (overridable
        // per step via a manifest's uiSteps[].timeoutMs) and succeed the instant the
        // condition is genuinely observed, instead of checking exactly once — this is
        // what lets a step survive Replit compilation/cold-starts, slow Wi-Fi, and async
        // render/hydration after the prior action. These were hardcoded UiTestExecutor
        // constants; lifting them here lets Shane tune the wait/cadence without a rebuild,
        // exactly like ReplitWatcherIntervalMinutes / InteractiveIdleFinalizeSeconds above.
        // Same %AppData%\BuildConsole\settings.json store / field-initializer-as-default
        // convention — a pre-existing settings.json (no "uiStepPoll*" keys) deserializes
        // with these defaults intact, preserving the current behaviour exactly. A
        // non-positive value read from settings.json falls back to the default in
        // UiTestExecutor rather than degenerating into a zero/negative window.

        /// <summary>Default bounded window (ms) a uiStep expect/click/input action polls the live DOM before failing, overridable per step via uiSteps[].timeoutMs. Default 30000 — long enough to absorb Replit cold-starts/rebuilds and slow-network latency. Non-positive falls back to the default in UiTestExecutor.</summary>
        public int UiStepPollTimeoutMs { get; set; } = 30000;

        /// <summary>Interval (ms) between DOM re-checks inside the uiStep poll loop. Default 250 — responsive enough to pass within a poll of the condition becoming true without hammering ExecuteScriptAsync. Non-positive falls back to the default in UiTestExecutor.</summary>
        public int UiStepPollIntervalMs { get; set; } = 250;

        // ── Git #1866 — desktop screen-clipping tool ──────────────────────────────
        // Shane: "a screenshot clipping tool ... auto put it in my system clipboard,
        // as well as save in C:\Users\Ronnie\Pictures\Screenshots\BuildConsole." The
        // default directory is DERIVED (MyPictures\Screenshots\BuildConsole) — never a
        // hardcoded username/path — so it resolves per-machine yet stays overridable
        // here without a rebuild. Same %AppData%\BuildConsole\settings.json store /
        // field-initializer-as-default convention as every field above; a pre-#1866
        // settings.json (no "screenClip*" keys) deserializes with these intact.

        /// <summary>Directory screen clips (PNG) are saved to. Defaults to the derived
        /// <c>MyPictures\Screenshots\BuildConsole</c> — no literal user path is baked into source.</summary>
        public string ScreenClipSaveDirectory { get; set; } =
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Screenshots", "BuildConsole");

        /// <summary>On by default: register the global PrintScreen (VK_SNAPSHOT) hotkey so a clip fires even
        /// when BuildConsole isn't focused. Windows 11's "Use the Print screen key to open Snipping Tool" can
        /// claim the key first, in which case registration fails gracefully (logged + toast + button tooltip)
        /// and only the in-app KeyUp path works. Flip off to hand the key back to Snipping Tool without a rebuild.</summary>
        public bool ScreenClipGlobalHotkeyEnabled { get; set; } = true;

        /// <summary>Git #2001 — off by default: shows/hides the title-bar token/cost readout
        /// (<c>UsageReadoutBorder</c>). Shane's judgement is the numbers aren't trustworthy, so the
        /// readout costs title-bar width without earning it. Purely a display choice — flipping this
        /// does NOT stop <c>UsageTrackingService</c> from recording; it keeps tracking and updating
        /// the (hidden) control the whole time, so the figures are current the moment this is
        /// switched back on. A settings.json with no key present deserializes to false (hidden).</summary>
        public bool ShowUsageReadout { get; set; } = false;

        // ── Git #1978 — explicit repo-root override ───────────────────────────────
        /// <summary>
        /// Git #1978 — explicit override for the repo root (the MAIN checkout BuildConsole
        /// manages worktrees from). Normally left EMPTY: <see cref="BuildTrackerConfig.FindRepoRoot"/>
        /// resolves the root automatically (config-file walk, then a stable .git walk) and
        /// caches it once at startup, immune to the transient File.Exists misses that used to
        /// silently no-op the worktree cleanup sweep. This is the last-resort manual pin for the
        /// case where neither walk can find it (e.g. a BuildConsole.exe launched from outside the
        /// repo tree). Empty (the default) means "resolve automatically". Same
        /// %AppData%\BuildConsole\settings.json store / field-initializer-as-default convention as
        /// every field above; a pre-#1978 settings.json (no "repoRootOverride" key) deserializes
        /// with this empty default intact.
        /// </summary>
        public string RepoRootOverride { get; set; } = "";

        private static string SettingsDir =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BuildConsole");

        private static string SettingsPath => Path.Combine(SettingsDir, "settings.json");

        // Git #2770 — the intermittent "Git 401 that clears itself after a manual Queue Panel
        // refresh" traced to THIS method colliding with a concurrent Save(). Load() reads
        // settings.json fresh on every call and is invoked from many threads/timers at once
        // (every GitHubApiClient is built from BuildConsoleSettings.Load().GitHubPat, and
        // startup fires a burst of board/queue polls simultaneously). The OLD Save() below used
        // a non-atomic File.WriteAllText, which truncates the file to zero bytes and THEN writes
        // — so a Load() landing in that window either got a sharing-violation IOException or a
        // torn/empty read. Either way the blanket `catch` returned a fresh BuildConsoleSettings
        // whose GitHubPat is "" — a GitHubApiClient built with an empty Bearer token 401s, and a
        // later manual refresh (reading the now-stable file) succeeds. Two fixes, together:
        //   1. Save() is now atomic (temp file + File.Move overwrite) so a reader never sees a
        //      partial/truncated file — this removes the race window itself.
        //   2. Load() retries a transient read/parse failure a few times before giving up (a
        //      sharing violation clears in milliseconds), and if it still fails on a file that
        //      genuinely EXISTS, logs LOUDLY rather than silently handing back blank credentials
        //      that masquerade as "no PAT configured" / cause a 401. A genuinely-absent file
        //      (fresh install) is still the legitimate empty-settings case and is not logged.
        public static BuildConsoleSettings Load()
        {
            bool fileExists;
            try { fileExists = File.Exists(SettingsPath); }
            catch { fileExists = false; }
            if (!fileExists) return new BuildConsoleSettings();

            const int maxAttempts = 4;
            Exception? lastError = null;
            for (int attempt = 1; attempt <= maxAttempts; attempt++)
            {
                try
                {
                    return LoadCore();
                }
                catch (Exception ex) when (attempt < maxAttempts && (ex is IOException || ex is JsonException))
                {
                    // A concurrent Save() (sharing violation) or a torn read of a half-written
                    // file — both transient and clear within milliseconds. Back off briefly and
                    // retry rather than degrading to blank credentials on the first stumble.
                    lastError = ex;
                    System.Threading.Thread.Sleep(25 * attempt); // 25ms, 50ms, 75ms
                }
                catch (Exception ex)
                {
                    lastError = ex;
                    break;
                }
            }

            // The file exists but every attempt to read/parse it failed. Do NOT pretend this is a
            // clean fresh install — that silent degrade to an empty GitHubPat is the #2770 bug.
            ActivityLog.Log("settings.load",
                $"WARNING: settings.json exists but could not be read after {maxAttempts} attempts " +
                $"({lastError?.GetType().Name}: {lastError?.Message}). Returning DEFAULT settings for this call " +
                $"— GitHub/credential-backed features will behave as if unconfigured until the next successful read. " +
                $"If a GitHub 401 or a spurious 'no PAT configured' appears right now, this is why (see #2770).");
            return new BuildConsoleSettings();
        }

        /// <summary>Git #2770 — the real read/deserialize/backfill body, factored out of <see cref="Load"/>
        /// so the retry loop above can re-invoke it. Throws on a transient IO/parse failure (the retry
        /// loop catches and retries); a genuinely-missing file is handled by the caller before this runs.</summary>
        private static BuildConsoleSettings LoadCore()
        {
            {
                var json = File.ReadAllText(SettingsPath);
                var settings = JsonSerializer.Deserialize<BuildConsoleSettings>(
                    json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                settings ??= new BuildConsoleSettings();
                settings.PausedBuildIds ??= new List<int>();

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

                // Seed user accounts if missing
                if (settings.UserAccounts == null || settings.UserAccounts.Count == 0)
                {
                    settings.UserAccounts = new List<UserAccountEntry>
                    {
                        new UserAccountEntry { Username = "standard_test_user", Password = "StandardPassword123!", AccountTier = "Standard", Notes = "Standard tier gating test account" },
                        new UserAccountEntry { Username = "enterprise_test_user", Password = "EnterprisePassword123!", AccountTier = "Enterprise", Notes = "Enterprise tier gating test account" }
                    };
                    settings.ActiveUserAccountId = settings.UserAccounts[0].Id;
                    settings.Save();
                }

                return settings;
            }
        }

        public void Save()
        {
            Directory.CreateDirectory(SettingsDir);
            var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });

            // Git #2770 — atomic write. The old File.WriteAllText truncated settings.json to zero
            // bytes then wrote, so a concurrent Load() (there are many — every GitHubApiClient is
            // built from Load().GitHubPat) could read an empty/partial file or hit a sharing
            // violation, degrade to blank credentials, and 401. Writing to a sibling temp file and
            // then File.Move(overwrite) means a reader ever only sees the OLD complete file or the
            // NEW complete file, never a half-written one. Temp lives in the same directory (same
            // volume) so the move is a real atomic replace on NTFS, not a copy.
            var tmpPath = SettingsPath + ".tmp";
            File.WriteAllText(tmpPath, json);
            File.Move(tmpPath, SettingsPath, overwrite: true);
        }
    }
}

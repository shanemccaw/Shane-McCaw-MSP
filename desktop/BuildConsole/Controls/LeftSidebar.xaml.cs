using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    public class SearchFileResult
    {
        public string FilePath { get; set; } = string.Empty;
        public string FileName => System.IO.Path.GetFileName(FilePath);
        public List<SearchResultLine> Matches { get; set; } = new();
        public string MatchCountStr => $"{Matches.Count} match{(Matches.Count == 1 ? "" : "es")}";
    }

    public class SearchResultLine
    {
        public string FilePath { get; set; } = string.Empty;
        public int LineNumber { get; set; }
        public string LineNumberStr => $"L{LineNumber}";
        public string Snippet { get; set; } = string.Empty;
    }

    public class GitMilestone
    {
        public string Title { get; set; } = string.Empty;
        public int CompletedCount { get; set; }
        public int TotalCount { get; set; }
        /// <summary>Git #875 — true only for a real GitHub milestone whose open/closed counts came from GetMilestonesAsync; the synthetic "No Milestone" bucket has no real counts to report, so its progress badge is hidden entirely rather than showing a misleading "0%".</summary>
        public bool HasRealCounts { get; set; }
        /// <summary>Git #921 — the real GitHub milestone number, or null for the synthetic "No Milestone" bucket. Carried so the milestone detail tab (and its clickable TreeViewItem data object) has a real handle, not just a decorative header.</summary>
        public int? GithubNumber { get; set; }
        /// <summary>Git #921 — real open/closed issue counts straight from GetMilestonesAsync (GitHub's own milestone open_issues/closed_issues), shown as separate glanceable pills in the milestone tab. Both zero when <see cref="HasRealCounts"/> is false.</summary>
        public int OpenIssues { get; set; }
        public int ClosedIssues { get; set; }
        public int ProgressPercent => TotalCount == 0 ? 0 : (CompletedCount * 100 / TotalCount);
        public string ProgressStr => $"{ProgressPercent}% ({CompletedCount}/{TotalCount})";
        public List<GitEpic> Epics { get; set; } = new();
    }

    public class GitEpic
    {
        public string Title { get; set; } = string.Empty;
        public string ColorHex { get; set; } = "#CBA6F7";
        public List<GitIssue> Issues { get; set; } = new();
    }

    public class GitIssue
    {
        public int IssueNumber { get; set; }
        public string NumberStr => $"#{IssueNumber}";
        public string Title { get; set; } = string.Empty;
        /// <summary>Git #843 — the real GitHub title with no display suffix (e.g. the epic tree's " (N sub)"), for the Edit dialog to pre-fill correctly.</summary>
        public string RawTitle { get; set; } = string.Empty;
        public string Priority { get; set; } = "HIGH";
        public string Status { get; set; } = "OPEN";
        /// <summary>lib/db/migrations/manual/*.sql path referenced in the real GitHub issue body, if any — Shane To-Do items only. See CreateIssueHeader's "Load SQL" context menu item.</summary>
        public string? SqlPath { get; set; }
        /// <summary>Git #843 — the real GitHub issue body, carried through from <see cref="GitBoardIssue.Body"/> so the Edit dialog can pre-fill it without a second fetch.</summary>
        public string Body { get; set; } = string.Empty;
        /// <summary>Git #844 — GraphQL databaseId carried through from <see cref="GitBoardIssue.DatabaseId"/>, the id GitHub's sub_issues endpoint wants as `sub_issue_id` (not the issue number).</summary>
        public long DatabaseId { get; set; }
        /// <summary>Git #922 (Epic #803) — carried through from <see cref="GitBoardIssue.IsEpic"/> so the right-click menu can offer the "Open/New Epic Chat" item only on epic nodes (an issue with real sub-issues).</summary>
        public bool IsEpic { get; set; }
        /// <summary>Git #845 (Git Board Phase 7) — real still-OPEN blocked_by dependency, populated lazily by EnrichBlockedStatusAsync (the board's own GraphQL fetch doesn't carry issue-dependency data).</summary>
        public bool IsBlocked { get; set; }
        public int? BlockedByNumber { get; set; }
        public string? BlockedByTitle { get; set; }
        public string PriorityBadge => Priority switch
        {
            "HIGH" => "🔥",
            "MED" => "🟡",
            _ => "🟢"
        };
    }

    public class GitItem
    {
        public string FilePath { get; set; } = string.Empty;
        public string RelativePath { get; set; } = string.Empty;
        public string FileName => System.IO.Path.GetFileName(FilePath);
        public string StatusLetter { get; set; } = "M";
        public bool IsStaged { get; set; }
        public Brush StatusBrush => StatusLetter switch
        {
            "M" => new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FAB387")),
            "A" or "U" or "?" => new SolidColorBrush((Color)ColorConverter.ConvertFromString("#A6E3A1")),
            "D" => new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")),
            _ => new SolidColorBrush((Color)ColorConverter.ConvertFromString("#89B4FA"))
        };
    }

    public class AutomationAction
    {
        public int Index { get; set; }
        public string IndexStr => $"#{Index}";
        public string ActionType { get; set; } = "click";
        public string ActionTypeUpper => ActionType.ToUpper();
        public string Selector { get; set; } = string.Empty;
        public string TagName { get; set; } = "div";
        public string Value { get; set; } = string.Empty;
        public Visibility ValueVisibility => string.IsNullOrEmpty(Value) ? Visibility.Collapsed : Visibility.Visible;
        public string Timestamp { get; set; } = DateTime.Now.ToString("HH:mm:ss");
        /// <summary>Git #806 — raw JSON of the manifest's optional uiSteps[].captureResponse block, carried through untouched for the UI executor (#809) to parse. Null for manually-recorded steps.</summary>
        public string? CaptureResponse { get; set; }
        /// <summary>Git #877 — raw JSON of the manifest's optional uiSteps[].extract block ({ as, regex } / { as, jsonPath }), carried through untouched for the UI executor to apply against the step's captured response body. Null for manually-recorded steps.</summary>
        public string? Extract { get; set; }
        /// <summary>Git #1016 — raw JSON of the manifest's optional uiSteps[].textContains field (a single
        /// string or an array of strings), carried through untouched for the UI executor's `expect` action
        /// to assert against the target element's real rendered text (el.innerText/textContent). Null for
        /// manually-recorded steps and steps that assert only element state.</summary>
        public string? TextContains { get; set; }
        /// <summary>Git #1025 — raw JSON of the manifest's optional uiSteps[].textPrefixOfAny field (a single
        /// string or array of strings, each typically a `{{name}}` referencing a `[*]`-wildcard extract of a
        /// whole runtime set). Carried through untouched for the UI executor's `expect` action to prefix-match
        /// the element's real rendered text against the resolved candidate set — the assertion that survives
        /// randomized + progressively-typed content (the hero headline). Null for steps that don't use it.</summary>
        public string? TextPrefixOfAny { get; set; }
        /// <summary>Git #970 — raw JSON of the manifest's optional uiSteps[].viewport field (preset name
        /// string or { width, height } object), carried through untouched for the UI executor's
        /// UiTestExecutor.ViewportSpec.Parse to resolve. Null for manually-recorded steps and steps that
        /// don't override the manifest-level default viewport.</summary>
        public string? Viewport { get; set; }
        /// <summary>Git #969 — the manifest's optional uiSteps[].maxDurationMs, carried through for UiTestExecutor to assert this step's elapsed time against. Null for manually-recorded steps (no threshold).</summary>
        public long? MaxDurationMs { get; set; }
        /// <summary>The manifest's optional uiSteps[].timeoutMs — the bounded window (ms) an `expect` step polls
        /// the DOM for its state/textContains condition before failing, overriding UiTestExecutor's default
        /// ExpectPollTimeoutMs. Null for manually-recorded steps and steps that accept the default window.</summary>
        public long? TimeoutMs { get; set; }
        /// <summary>Git #966 — the manifest uiStep's optional `"screenshot": true` flag: when set, UiTestExecutor
        /// always captures a WebView2 screenshot after this step, not only on failure. False for manually-recorded steps.</summary>
        public bool Screenshot { get; set; }
    }

    public partial class LeftSidebar : UserControl
    {
        private string _currentView = "Chats";
        private const string RootWorkspacePath = @"C:\Source\ShaneMcCawConsulting\Shane-McCaw-MSP";

        public event EventHandler<string>? FileSelected;
        /// <summary>
        /// Git #802 - carries the resolved real GitHub number alongside the
        /// chat (chat's own IssueGithubNumber, falling back to its linked
        /// epic's) so MainWindow can match it against a live queue item and
        /// show/hide that tab's build split pane - the URL alone isn't enough.
        /// </summary>
        public event EventHandler<(BoardChat Chat, int? GithubNumber)>? ChatSelected;

        /// <summary>
        /// Git #922 (Epic #803) — raised when a right-click on an epic wants to
        /// open a Claude chat tab. <c>InjectPrefill == false</c> just opens
        /// <c>Url</c> (an existing linked chat's ClaudeUrl — task 1, "open that
        /// Epic's chat"). <c>InjectPrefill == true</c> opens a fresh
        /// "New chat project URL" carrying a <c>?bt_prefill=</c> param that
        /// MainWindow's OpenWebTab replicates the browser extension's
        /// composer-poll+insert against (task 2, "create new chat"), since
        /// BuildConsole's WebView2 isn't real Chrome with the extension running.
        /// <para>Git #922 follow-up — <c>EpicGithubNumber</c> carries the epic's
        /// GitHub issue number on the new-chat path so MainWindow can link the
        /// resulting BoardChat to the epic once Shane sends the message; null on the
        /// "open existing linked chat" path (that chat is already associated).</para>
        /// </summary>
        public event EventHandler<(string Url, string Title, bool InjectPrefill, int? EpicGithubNumber)>? EpicChatRequested;

        /// <summary>Git #922 — the SAME query-param name (<c>EPIC_CHAT_PREFILL_PARAM</c>) the browser extension's openNewEpicChat/tryInsertPrefillFromUrl already use, so a URL BuildConsole opens is one the extension itself would also recognize if Shane ever opens it in real Chrome.</summary>
        private const string EpicChatPrefillParam = "bt_prefill";

        /// <summary>Git #840 (Git Board Phase 2) — fired when Shane clicks an issue node in the Git Board tree, so MainWindow can show its real description/comment thread.</summary>
        public event EventHandler<GitIssue>? IssueSelected;
        /// <summary>Git #921 (Epic #803) — fired when Shane clicks a milestone header in the Git Board tree, so MainWindow opens (or focuses) its native ADHD-friendly milestone detail tab. Additive to the tree; milestones have no side-panel behaviour of their own.</summary>
        public event EventHandler<GitMilestone>? MilestoneTabRequested;
        /// <summary>Git #921 (Epic #803) — fired alongside <see cref="IssueSelected"/> when Shane clicks an issue/epic node, so MainWindow opens (or focuses) its native detail tab (epic vs issue routed by <see cref="GitIssue.IsEpic"/>). Deliberately additive: <see cref="IssueSelected"/> still drives the quick-glance side panel.</summary>
        public event EventHandler<GitIssue>? GitDetailTabRequested;
        /// <summary>Fired when Shane clicks "Load SQL" on a Shane To-Do item — MainWindow fetches the real text and hands it to SqlRunnerView.</summary>
        public event EventHandler<string>? SqlLoadRequested;
        public event EventHandler<bool>? PinToggled;
        /// <summary>Git #954 (Epic #803) — raised when the user clicks a category in the sidebar's Settings nav list; MainWindow opens (or focuses) the native Settings tab scrolled to that section. The string is the category key (General / Credentials / TestEnvironment / ChatIntegration / WebTools / ReplitWatcher).</summary>
        public event EventHandler<string>? SettingsCategoryRequested;
        /// <summary>
        /// Git #815 — Shane: "I don't want to have to click the refresh
        /// button all the time... or an error alert when it fails." Fired
        /// with a message on a failed poll, null on the next successful one
        /// (MainWindow shows/clears a real status-bar indicator instead of
        /// the failure sitting silently as inline tree text nobody notices).
        /// </summary>
        public event EventHandler<string?>? SyncError;
        /// <summary>
        /// Git #859 (Git panel Phase 1, sub-issue of Epic #803) — fired after
        /// the debounced FileSystemWatcher refresh runs RefreshGitStatus(), on
        /// the UI thread. Git panel Phase 2 (#860)'s commit graph hooks into
        /// this same trigger so it refreshes together with the Changes list,
        /// not on a separate/inconsistent schedule.
        /// </summary>
        public event EventHandler? WorkspaceChanged;

        /// <summary>Set by MainWindow — resolves the currently-focused editor tab's chat
        /// URL, or null if the active tab isn't a chat tab. Backs "Assign Chat to
        /// Epic..."'s "Assign current chat" button so Shane doesn't have to
        /// copy/paste when the chat he wants is already open.</summary>
        public Func<string?>? GetActiveChatUrl { get; set; }

        private bool _isPinned = true;

        private void BtnPinSidebar_Click(object sender, RoutedEventArgs e)
        {
            _isPinned = !_isPinned;
            PinSidebarIcon.Text = _isPinned ? "📌" : "📍";
            PinToggled?.Invoke(this, _isPinned);
        }

        /// <summary>
        /// Git #842 (Git Board Phase 4) — Shane: confirmed by code audit that
        /// this "+" button had no click handler at all. Only wired for the
        /// Issues view (SwitchView already sets its tooltip to "New Issue"
        /// there) — the other views' tooltips ("New Chat", "New File", etc.)
        /// aren't in this task's scope, so BtnNewItem stays a no-op for them,
        /// same as before this change.
        /// </summary>
        private async void BtnNewItem_Click(object sender, RoutedEventArgs e)
        {
            if (_currentView == "Issues")
            {
                await CreateNewIssueAsync();
            }
        }

        /// <summary>
        /// Git #863 — Shane: "how do I refresh the Git list in the Git Board?
        /// Because it's not up to date." No manual refresh existed on the Git
        /// Board toolbar (only view-switch or post-CRUD refreshed it).
        /// </summary>
        private void BtnRefreshGitBoard_Click(object sender, RoutedEventArgs e)
        {
            // Manual-only GitHub (Shane, 2026-08-14): this is now the PRIMARY
            // trigger for Git Board GitHub traffic — the background poll was
            // removed. Logged on the shared github.manual-refresh channel (source
            // here; the real outcome/count follows on git-board.data) so every
            // GitHub call this app makes is attributable to a real click.
            ActivityLog.Log("github.manual-refresh",
                "Git Board [manual Refresh click]: forcing a fresh GitHub fetch (GraphQL issues + REST milestones + blocked_by).");
            // Git #923 — a deliberate click should always mean a real, uncached
            // fetch and a guaranteed repaint. A manual refresh also re-runs the
            // blocked_by sweep immediately (bypass its 3-min throttle), since the
            // whole point of clicking Refresh is "re-check GitHub right now."
            _lastBlockedEnrichUtc = DateTime.MinValue;
            PopulateGitTrackerBoard(forceFresh: true);
        }

        public void ExpandPanel()
        {
            _isPinned = true;
            PinSidebarIcon.Text = "📌";
        }

        private BuildTrackerApiClient? _api;
        private DispatcherTimer? _pollTimer;

        // Manual-only GitHub (Shane, 2026-08-14): the Git Board's hands-off
        // background GitHub poll was REMOVED entirely — "this app is killing my
        // git connections... turn git into a manual refresh." The Git Board now
        // fetches GitHub ONLY on an explicit user action: opening the Issues tab
        // (SwitchView -> PopulateGitTrackerBoard) or the manual Refresh button
        // (BtnRefreshGitBoard_Click). The shared _pollTimer below no longer
        // touches GitHub at all — it only refreshes the Chats tree, which hits
        // the LOCAL DEV SERVER (GET /extension/board), not GitHub's API.

        /// <summary>Git #876 (reopened) — true only when the BuildConsole window hosting this sidebar is genuinely on screen (present, visible, not minimized). The background GitHub/board/chat polls are suppressed entirely otherwise: "heavy traffic for no reason" was the app polling every 20s while minimized or hidden.</summary>
        private bool IsHostWindowVisible()
        {
            var w = Window.GetWindow(this);
            return w != null && w.IsVisible && w.WindowState != WindowState.Minimized;
        }

        /// <summary>Called once from MainWindow with the shared API client — the Issues board fetches on demand once this is set.</summary>
        public void Initialize(BuildTrackerApiClient api)
        {
            _api = api;
            // Git #954 (Epic #803) — the Build Tracker API read-only display moved
            // to the native Settings tab (SettingsTabView.Initialize); nothing to
            // populate in the sidebar here anymore.

            // Git #815 — both boards used to load ONLY when Shane switched to
            // that tab (or clicked a manual refresh), so anything that
            // changed while he was looking at a different view (or just
            // sitting on the same one) needed a manual click to show up.
            // Poll both regardless of which view is currently visible - cheap
            // (same two GETs BuildQueuePanel and the extension already poll
            // this often) and keeps everything current without Shane having
            // to remember to refresh.
            if (api.IsConfigured)
            {
                _pollTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
                _pollTimer.Tick += (_, _) =>
                {
                    // Never poll while the host window isn't on screen — no visible
                    // window = no reason to be talking to the dev server at all.
                    if (!IsHostWindowVisible()) return;

                    // Manual-only GitHub (Shane, 2026-08-14): the Git Board GitHub
                    // fetch that USED to run here on a background cadence is GONE —
                    // it now happens only on an explicit user action (opening the
                    // Issues tab, or the manual Refresh button). This timer no
                    // longer touches GitHub. It only refreshes the Chats tree,
                    // which hits the LOCAL DEV SERVER (GET /extension/board), not
                    // GitHub, so it doesn't consume the shared 5,000/hr rate limit.
                    PopulateChatsTree();
                };
                _pollTimer.Start();
                ActivityLog.Log("git-board.traffic",
                    "Git Board background GitHub poll DISABLED (Shane: manual-refresh-only, to stop rate-limit burn). "
                    + "The 20s shared timer now refreshes only the Chats tree (local dev server, not GitHub); "
                    + "Git Board GitHub traffic fires solely on tab-open (SwitchView) or the manual Refresh button.");
            }
        }

        public LeftSidebar()
        {
            InitializeComponent();
            LoadWorkspaceExplorer(RootWorkspacePath);
            SetupGitWatcher();
        }

        // ── SETTINGS: sidebar category navigation (Git #954, Epic #803) ──────
        // The sidebar's Settings view is now just a category list; clicking a
        // category opens (or focuses) the native Settings tab scrolled to that
        // section. All the real fields + their save/add/edit/remove handlers now
        // live in SettingsTabView (Controls/SettingsTabView.xaml[.cs]).
        private void SidebarSettingsCategory_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string category)
                SettingsCategoryRequested?.Invoke(this, category);
        }

        private void ExplorerTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem item && item.Tag is string path && File.Exists(path))
            {
                FileSelected?.Invoke(this, path);
            }
        }

        private void ExplorerTree_PreviewMouseWheel(object sender, System.Windows.Input.MouseWheelEventArgs e)
        {
            if (ExplorerScrollViewer != null)
            {
                ExplorerScrollViewer.ScrollToVerticalOffset(ExplorerScrollViewer.VerticalOffset - e.Delta);
                e.Handled = true;
            }
        }

        public event EventHandler<string>? StartRecordingRequested;
        public event EventHandler? StopRecordingRequested;

        /// <summary>Git #963/Epic #803 — carries the currently-loaded manifest so MainWindow can run
        /// it through the same real <c>RunManifestAsync</c> pipeline every other trigger uses. Used to
        /// carry <c>(url, RecordedSteps)</c> for the recording-only playback path, but #963 removed the
        /// Record button, so <c>RecordedSteps</c> is now permanently empty and that path ran zero steps —
        /// Play now runs the whole manifest (api/graph/postGraphApi/zoho/uiSteps/powerShellVerify).</summary>
        public event EventHandler<TestManifest>? PlayTestRequested;

        public readonly List<AutomationAction> RecordedSteps = new();

        public void RecordAction(string actionType, string selector, string tagName, string val)
        {
            AddRecordedStep(actionType, selector, tagName, val);
        }

        public void AddRecordedStep(string actionType, string selector, string tagName, string val)
        {
            var action = new AutomationAction
            {
                Index = RecordedSteps.Count + 1,
                ActionType = actionType,
                Selector = selector,
                TagName = tagName,
                Value = val
            };
            RecordedSteps.Add(action);
            AutomationStepsList.Items.Add(action);
        }

        /// <summary>Git #963 — Play used to fire with <c>RecordedSteps</c>, but that list was only ever
        /// populated by the (now-removed) Record button, so it's permanently empty and Play replayed nothing.
        /// Play now hands MainWindow the currently-loaded manifest itself and lets it run through the exact
        /// same <c>RunManifestAsync</c> pipeline as Menu &gt; Run Tests / the regression sweep / the #898
        /// remote trigger — baseUrl and every {{DEPLOY_URL}}/{{…}} placeholder are resolved by that pipeline,
        /// not here, so Play never fires with a stale/empty target and covers all test kinds, not just uiSteps.</summary>
        private void BtnPlayTest_Click(object sender, RoutedEventArgs e)
        {
            if (_lastLoadedManifest == null)
            {
                ToastEngine.Warning("Play Test", "Select a test from Available Tests before playing.");
                return;
            }

            PlayTestRequested?.Invoke(this, _lastLoadedManifest);
        }

        // ── Git #806: manifest loader (Epic #803 Phase 2) ───────────────────
        /// <summary>Fired after a manifest loads successfully — carries the parsed manifest so MainWindow can track it for Menu &gt; Run &gt; "Run Tests (Current Issue)".</summary>
        public event EventHandler<TestManifest>? ManifestLoaded;

        /// <summary>Fired from the manifest steps flyout's "History" button — carries the manifest's Issue
        /// number so MainWindow can open (or focus) TestHistoryWindow filtered to just that manifest's own
        /// run history, per Git discoverability fix (TestHistoryWindow had no entry point).</summary>
        public event EventHandler<int>? ManifestHistoryRequested;

        /// <summary>Git #963 — the last manifest selected in ManifestFilesTree, so BtnPlayTest_Click can resolve its target URL from the manifest's own baseUrl instead of the removed URL box.</summary>
        private TestManifest? _lastLoadedManifest;

        /// <summary>Git #984 — one manifest as tree data: its #983 relative path (the load key), the
        /// area it groups under (first path segment), its bare filename (shown at the leaf), and its real
        /// file creation time (leaves sort by this, most recent first). Held in <see cref="_manifestEntries"/>
        /// so the search box can re-render the tree without re-hitting disk.</summary>
        private sealed class ManifestEntry
        {
            public string RelativePath = "";
            public string Area = "";
            public string FileName = "";
            public DateTime CreatedUtc;
        }

        private List<ManifestEntry> _manifestEntries = new();

        /// <summary>Git #984 — distinct, existing-palette accent colors rotated per area so Shane can tell an
        /// auth test from a copilot-readiness test at a glance. Assignment is a stable hash of the area name
        /// (see <see cref="AreaBrushKey"/>) so a given area keeps its color regardless of which other areas
        /// happen to be present.</summary>
        private static readonly string[] AreaBrushKeys =
            { "BlueBrush", "MauveBrush", "GreenBrush", "PeachBrush", "YellowBrush", "RedBrush" };

        private static string AreaBrushKey(string area)
        {
            int h = 0;
            foreach (char c in area) h = (h * 31 + c) & 0x7fffffff;
            return AreaBrushKeys[h % AreaBrushKeys.Length];
        }

        /// <summary>Git #869 — enumerates test-manifests/**/*.json for the in-panel list, replacing the old OpenFileDialog. Called on Automation view-load and from the refresh button.
        /// Recursive as of the #960 area/feature-slug folder migration — entries are paths relative to manifestsDir (not bare filenames) so Path.Combine in ManifestFilesTree_SelectedItemChanged still resolves,
        /// and _regression-suite.json (the index, not a runnable test) is excluded.
        /// Git #984 — reads each manifest into a <see cref="ManifestEntry"/> (area = first path segment, plus real creation time) and hands off to <see cref="RenderManifestTree"/> for the grouped color-coded tree.</summary>
        private void PopulateManifestsList()
        {
            string manifestsDir = Path.Combine(RootWorkspacePath, "test-manifests");
            var entries = new List<ManifestEntry>();

            if (Directory.Exists(manifestsDir))
            {
                foreach (var full in Directory.GetFiles(manifestsDir, "*.json", SearchOption.AllDirectories))
                {
                    string rel = Path.GetRelativePath(manifestsDir, full);
                    if (rel.Equals("_regression-suite.json", StringComparison.OrdinalIgnoreCase)) continue;

                    // Area = first path segment; a manifest sitting flat at the top level buckets under "(root)".
                    var parts = rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                    string area = parts.Length > 1 ? parts[0] : "(root)";

                    DateTime created;
                    try { created = File.GetCreationTimeUtc(full); }
                    catch { created = DateTime.MinValue; }

                    entries.Add(new ManifestEntry
                    {
                        RelativePath = rel,
                        Area = area,
                        FileName = Path.GetFileName(rel),
                        CreatedUtc = created,
                    });
                }
            }

            _manifestEntries = entries;
            ActivityLog.Log("testing.manifest-list", $"listed {entries.Count} manifest(s) in {manifestsDir}");
            RenderManifestTree();
        }

        /// <summary>Git #984 — (re)builds the area-grouped TreeView from <see cref="_manifestEntries"/>, applying
        /// the current search text. Areas are alphabetical (a stable top-level index); leaves within each area
        /// sort by real file creation date, most recent first. Collapsed by default; while searching, areas with
        /// a match auto-expand and non-matching areas/leaves drop out. An area whose name itself matches shows all
        /// of its children.</summary>
        private void RenderManifestTree()
        {
            if (ManifestFilesTree == null) return;

            string search = (ManifestSearchBox?.Text ?? "").Trim();
            bool searching = search.Length > 0;

            ManifestFilesTree.Items.Clear();

            var byArea = _manifestEntries
                .GroupBy(e => e.Area)
                .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase);

            int shown = 0;
            foreach (var group in byArea)
            {
                bool areaMatches = searching && group.Key.Contains(search, StringComparison.OrdinalIgnoreCase);

                var leaves = group
                    .Where(e => !searching || areaMatches
                                || e.FileName.Contains(search, StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(e => e.CreatedUtc)
                    .ThenBy(e => e.FileName, StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (leaves.Count == 0) continue;

                string brushKey = AreaBrushKey(group.Key);
                var areaNode = new TreeViewItem
                {
                    Header = MakeAreaHeader(group.Key, leaves.Count, brushKey),
                    IsExpanded = searching,   // collapsed by default; matches auto-expand while searching
                    ContextMenu = BuildAreaContextMenu(),   // area headers carry no manifest — just bulk expand/collapse
                };

                foreach (var leaf in leaves)
                {
                    var leafNode = new TreeViewItem
                    {
                        Header = MakeLeafHeader(leaf.FileName, brushKey),
                        Tag = leaf.RelativePath,   // #983 relative path — the load key
                    };
                    leafNode.ContextMenu = BuildManifestLeafContextMenu(leafNode, leaf.RelativePath);
                    areaNode.Items.Add(leafNode);
                    shown++;
                }

                ManifestFilesTree.Items.Add(areaNode);
            }

            TxtNoManifests.Visibility = shown == 0 ? Visibility.Visible : Visibility.Collapsed;
            TxtNoManifests.Text = searching && shown == 0
                ? $"No test matches \"{search}\"."
                : "No test manifests found in test-manifests/.";
        }

        /// <summary>Git #984 — colored area row: a small color chip + the area name in the area's accent color +
        /// a real count badge (e.g. "copilot-readiness (6)").</summary>
        private FrameworkElement MakeAreaHeader(string area, int count, string brushKey)
        {
            var brush = (Brush)FindResource(brushKey);
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            sp.Children.Add(new Border
            {
                Width = 8,
                Height = 8,
                CornerRadius = new CornerRadius(2),
                Background = brush,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center,
            });
            sp.Children.Add(new TextBlock
            {
                Text = area,
                FontSize = 12,
                FontWeight = FontWeights.SemiBold,
                Foreground = brush,
                VerticalAlignment = VerticalAlignment.Center,
            });
            sp.Children.Add(new TextBlock
            {
                Text = $" ({count})",
                FontSize = 11,
                Foreground = (Brush)FindResource("Subtext0Brush"),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(4, 0, 0, 0),
            });
            return sp;
        }

        /// <summary>Git #984 — a leaf (manifest filename) with a thin area-colored bar down its left edge, so a
        /// whole area still reads as one group without tinting the filename text itself (keeps it readable, and
        /// avoids a red area reading as an "error").</summary>
        private FrameworkElement MakeLeafHeader(string fileName, string brushKey)
        {
            var dp = new DockPanel();
            dp.Children.Add(new Border
            {
                Width = 3,
                CornerRadius = new CornerRadius(1),
                Background = (Brush)FindResource(brushKey),
                Margin = new Thickness(0, 1, 6, 1),
            }); // DockPanel.Dock defaults to Left → a full-height vertical bar
            dp.Children.Add(new TextBlock
            {
                Text = fileName,
                FontSize = 11,
                Foreground = (Brush)FindResource("TextBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
            });
            return dp;
        }

        private void ManifestSearchBox_TextChanged(object sender, TextChangedEventArgs e) => RenderManifestTree();

        private void BtnRefreshManifests_Click(object sender, RoutedEventArgs e)
        {
            PopulateManifestsList();
        }

        /// <summary>Git #984 — selecting a leaf loads that manifest and opens #952's steps flyout, exactly as the
        /// old ListBox SelectionChanged did — only the manifest path now arrives via the leaf's Tag (#983's
        /// relative path) instead of the ListBox's selected string. Area header nodes carry no Tag, so clicking
        /// one just expands/collapses and is ignored here.</summary>
        private void ManifestFilesTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is not TreeViewItem tvi || tvi.Tag is not string fileName) return;
            LoadManifestLeaf(tvi, fileName);
        }

        private TestManifest? LoadManifestLeaf(TreeViewItem tvi, string fileName)
        {
            string manifestsDir = Path.Combine(RootWorkspacePath, "test-manifests");
            string fullPath = Path.Combine(manifestsDir, fileName);

            var manifest = TestManifest.LoadFromFile(fullPath);
            if (manifest == null)
            {
                ToastEngine.Error("Load Manifest", $"Couldn't parse {fileName} as a test manifest.");
                return null;
            }

            _lastLoadedManifest = manifest;

            // Badges reflect the selected manifest (now positioned above the list, per #952).
            ApiTestsBadge.Text = $"API: {manifest.ApiTests.Count}";
            GraphTestsBadge.Text = $"Graph: {manifest.GraphTests.Count}";
            ManifestBadgesRow.Visibility = Visibility.Visible;

            // Git #952 — clicking a test now opens a read-only steps flyout instead of loading the
            // manifest's uiSteps into "Recorded Test Actions"; that list stays dedicated to live Record.
            PopulateStepsFlyout(manifest, fileName);
            ManifestStepsPopup.IsOpen = true;

            ActivityLog.Log("testing.manifest-list", $"opened steps flyout for \"{fileName}\" ({manifest.ApiTests.Count} api, {manifest.GraphTests.Count} graph, {manifest.UiSteps.Count} ui steps)");

            // MainWindow still tracks this as the loaded manifest for Menu > Run > "Run Tests (Current Issue)".
            ManifestLoaded?.Invoke(this, manifest);

            return manifest;
        }

        /// <summary>Git #1017 — double-clicking a leaf feels like "select + Play Test" in one action: loads it
        /// through the exact same path a single click already uses, then immediately fires the same real run
        /// path <see cref="BtnPlayTest_Click"/> uses. Walks up from the click's real hit-test target rather than
        /// trusting SelectedItem, so an area-group header (no Tag — see <see cref="RenderManifestTree"/>) just
        /// expands/collapses on double-click like any TreeView, and never triggers a run.</summary>
        private void ManifestFilesTree_MouseDoubleClick(object sender, MouseButtonEventArgs e)
        {
            var tvi = FindAncestorTreeViewItem(e.OriginalSource as DependencyObject);
            if (tvi == null || tvi.Tag is not string fileName) return;

            var manifest = LoadManifestLeaf(tvi, fileName);
            if (manifest == null) return;

            PlayTestRequested?.Invoke(this, manifest);
            e.Handled = true;
        }

        private static TreeViewItem? FindAncestorTreeViewItem(DependencyObject? source)
        {
            while (source != null && source is not TreeViewItem)
            {
                source = source is Visual or System.Windows.Media.Media3D.Visual3D
                    ? VisualTreeHelper.GetParent(source)
                    : LogicalTreeHelper.GetParent(source);
            }
            return source as TreeViewItem;
        }

        // ── Manifest tree right-click menus ─────────────────────────────────
        // Reuses #945's real ContextMenu/MenuItem styling directly (the same
        // plain `new ContextMenu()` / `new MenuItem` shape CreateExplorerContextMenu
        // already uses in this file — the app's implicit dark ContextMenu style
        // applies automatically). Scoped to leaf manifest nodes; area-group
        // headers get their own bulk expand/collapse menu (BuildAreaContextMenu).
        // Each item bakes its target path into the closure, so the menu always
        // acts on the node it was opened from — no reliance on tree SelectedItem.

        /// <summary>Right-click menu for one manifest leaf. Run reuses the exact double-click run path
        /// (LoadManifestLeaf → PlayTestRequested). View Run Diagram / View Raw JSON open the dedicated
        /// ManifestViewerWindow (now landed) on its workflow-chart / raw-JSON view respectively. Edit opens
        /// the manifest through the same
        /// FileSelected → OpenFileTab path every other file uses (JSON lands in the Monaco editor), consistent
        /// with Explorer's "Open". Copy Path / Reveal in Explorer mirror CreateExplorerContextMenu exactly.</summary>
        private ContextMenu BuildManifestLeafContextMenu(TreeViewItem leafNode, string relativePath)
        {
            string manifestsDir = Path.Combine(RootWorkspacePath, "test-manifests");
            string fullPath = Path.Combine(manifestsDir, relativePath);

            var cm = new ContextMenu();

            // 1. Run — same real run path the double-click handler uses.
            var miRun = new MenuItem { Header = "▶  Run" };
            miRun.Click += (s, e) =>
            {
                var manifest = LoadManifestLeaf(leafNode, relativePath);
                if (manifest != null) PlayTestRequested?.Invoke(this, manifest);
            };
            cm.Items.Add(miRun);

            cm.Items.Add(new Separator());

            // 2 & 3. View Run Diagram / View Raw JSON — open the dedicated ManifestViewerWindow (now landed) on
            // its workflow-chart or raw-JSON view respectively, for the manifest this menu was opened from.
            var miDiagram = new MenuItem { Header = "View Run Diagram", ToolTip = "Open the Manifest Viewer's workflow chart for this manifest" };
            miDiagram.Click += (s, e) => OpenManifestViewerFromPath(fullPath, showChartFirst: true);
            cm.Items.Add(miDiagram);

            var miRawJson = new MenuItem { Header = "View Raw JSON", ToolTip = "Open the Manifest Viewer's raw-JSON view for this manifest" };
            miRawJson.Click += (s, e) => OpenManifestViewerFromPath(fullPath, showChartFirst: false);
            cm.Items.Add(miRawJson);

            // 4. Edit — open as a normal editor tab (Monaco for .json), the app's standard file-open path.
            var miEdit = new MenuItem { Header = "Edit" };
            miEdit.Click += (s, e) => FileSelected?.Invoke(this, fullPath);
            cm.Items.Add(miEdit);

            cm.Items.Add(new Separator());

            // 5. Copy Path — the real absolute file path.
            var miCopyPath = new MenuItem { Header = "Copy Path" };
            miCopyPath.Click += (s, e) => Clipboard.SetText(fullPath);
            cm.Items.Add(miCopyPath);

            // 6. Reveal in Explorer — same /select shape CreateExplorerContextMenu uses.
            var miReveal = new MenuItem { Header = "Reveal in Explorer" };
            miReveal.Click += (s, e) =>
            {
                try { System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{fullPath}\""); }
                catch { }
            };
            cm.Items.Add(miReveal);

            cm.Items.Add(new Separator());

            // Bonus — Duplicate: low-risk, copies the file to "<name>-copy.json" beside itself and re-lists so
            // the new leaf appears. New file only; never touches the original. (Rename is deliberately NOT
            // offered: a manifest is registered in test-manifests/_regression-suite.json by its path, so a
            // silent rename here would orphan that registration — not a low-risk convenience.)
            var miDuplicate = new MenuItem { Header = "Duplicate" };
            miDuplicate.Click += (s, e) => DuplicateManifest(fullPath);
            cm.Items.Add(miDuplicate);

            return cm;
        }

        /// <summary>Area-header right-click — just bulk expand/collapse every area, since a header row carries
        /// no manifest of its own to act on.</summary>
        private ContextMenu BuildAreaContextMenu()
        {
            var cm = new ContextMenu();

            var miExpand = new MenuItem { Header = "Expand All" };
            miExpand.Click += (s, e) => SetAllManifestAreasExpanded(true);
            cm.Items.Add(miExpand);

            var miCollapse = new MenuItem { Header = "Collapse All" };
            miCollapse.Click += (s, e) => SetAllManifestAreasExpanded(false);
            cm.Items.Add(miCollapse);

            return cm;
        }

        private void SetAllManifestAreasExpanded(bool expanded)
        {
            if (ManifestFilesTree == null) return;
            foreach (var item in ManifestFilesTree.Items)
                if (item is TreeViewItem tvi) tvi.IsExpanded = expanded;
        }

        /// <summary>Copies a manifest to "&lt;name&gt;-copy.json" (bumping -copy-2, -copy-3… if taken) in the same
        /// folder, then re-lists so the new leaf shows immediately. Best-effort; a failure just message-boxes.</summary>
        private void DuplicateManifest(string fullPath)
        {
            try
            {
                string dir = Path.GetDirectoryName(fullPath) ?? "";
                string name = Path.GetFileNameWithoutExtension(fullPath);
                string ext = Path.GetExtension(fullPath);
                string candidate = Path.Combine(dir, $"{name}-copy{ext}");
                int n = 2;
                while (File.Exists(candidate))
                    candidate = Path.Combine(dir, $"{name}-copy-{n++}{ext}");

                File.Copy(fullPath, candidate);
                ActivityLog.Log("testing.manifest-list", $"duplicated {Path.GetFileName(fullPath)} -> {Path.GetFileName(candidate)}");
                PopulateManifestsList();
            }
            catch (Exception ex)
            {
                ToastEngine.Error("Duplicate Manifest", $"Couldn't duplicate the manifest: {ex.Message}");
            }
        }

        // ── Git #952: manifest steps flyout ─────────────────────────────────
        private void BtnCloseStepsFlyout_Click(object sender, RoutedEventArgs e) => ManifestStepsPopup.IsOpen = false;

        /// <summary>Opens the fuller Manifest Viewer (raw JSON tree + native-Canvas workflow chart) for the
        /// currently-selected manifest — the same <see cref="_lastLoadedManifest"/> this flyout was populated
        /// from. Closes the flyout so the window takes focus.</summary>
        private void BtnOpenManifestViewer_Click(object sender, RoutedEventArgs e)
        {
            if (_lastLoadedManifest == null) return;
            ManifestStepsPopup.IsOpen = false;
            OpenManifestViewer(_lastLoadedManifest, showChartFirst: false);
        }

        /// <summary>History button in the manifest steps flyout — opens Test History filtered to this
        /// manifest's own Issue number rather than the full unfiltered history.</summary>
        private void BtnOpenManifestHistory_Click(object sender, RoutedEventArgs e)
        {
            if (_lastLoadedManifest == null) return;
            ManifestStepsPopup.IsOpen = false;
            ManifestHistoryRequested?.Invoke(this, _lastLoadedManifest.Issue);
        }

        /// <summary>Parses the manifest at <paramref name="fullPath"/> and opens the Manifest Viewer on the
        /// requested view — the entry point the leaf right-click "View Run Diagram" / "View Raw JSON" items use
        /// (they carry a path, not an already-parsed manifest).</summary>
        private void OpenManifestViewerFromPath(string fullPath, bool showChartFirst)
        {
            var manifest = TestManifest.LoadFromFile(fullPath);
            if (manifest == null)
            {
                ToastEngine.Error("Manifest Viewer", $"Couldn't parse {Path.GetFileName(fullPath)} as a test manifest.");
                return;
            }
            OpenManifestViewer(manifest, showChartFirst);
        }

        /// <summary>Shows the ManifestViewerWindow non-modally (Show, not ShowDialog, so the rest of the app
        /// stays usable), owned by the main window so it floats above it.</summary>
        private void OpenManifestViewer(TestManifest manifest, bool showChartFirst)
        {
            var viewer = new BuildConsole.ManifestViewerWindow(manifest, showChartFirst) { Owner = Window.GetWindow(this) };
            viewer.Show();
        }

        /// <summary>Git #988 — the same click that opens the popup (tree SelectionChanged, itself fired from a
        /// mouse-up) was being read as an "outside click" under the old StaysOpen="False", closing it the instant
        /// it opened. Now StaysOpen="True" and dismissal is explicit: hook the owning Window's PreviewMouseDown
        /// once this click has fully settled (deferred via Dispatcher.BeginInvoke at Input priority, so we attach
        /// AFTER the current mouse-up finishes dispatching rather than mid-event) plus Escape. Because this Popup
        /// has AllowsTransparency="True" it renders in its own top-level layered window, so clicks anywhere inside
        /// it (including the close button) never reach the owning Window's handlers at all — every PreviewMouseDown
        /// that DOES reach the Window is by definition outside the popup, no additional hit-testing needed.</summary>
        private void ManifestStepsPopup_Opened(object sender, EventArgs e)
        {
            var window = Window.GetWindow(this);
            if (window == null) return;

            Dispatcher.BeginInvoke(new Action(() =>
            {
                if (!ManifestStepsPopup.IsOpen) return; // already closed again before this ran
                window.PreviewMouseDown += CloseStepsFlyoutOnWindowClick;
                window.PreviewKeyDown += CloseStepsFlyoutOnEscape;
            }), DispatcherPriority.Input);
        }

        private void ManifestStepsPopup_Closed(object sender, EventArgs e)
        {
            var window = Window.GetWindow(this);
            if (window == null) return;

            window.PreviewMouseDown -= CloseStepsFlyoutOnWindowClick;
            window.PreviewKeyDown -= CloseStepsFlyoutOnEscape;
        }

        private void CloseStepsFlyoutOnWindowClick(object sender, MouseButtonEventArgs e) => ManifestStepsPopup.IsOpen = false;

        private void CloseStepsFlyoutOnEscape(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Escape) return;
            ManifestStepsPopup.IsOpen = false;
            e.Handled = true;
        }

        /// <summary>Git #952 — renders the selected manifest's steps into the flyout Popup: one section per
        /// apiTests / graphTests / postGraphApiTests / zohoTests / powerShellVerify / uiSteps group, each entry on
        /// a readable line. Purely a read-only view — never touches RecordedSteps/AutomationStepsList.</summary>
        private void PopulateStepsFlyout(TestManifest manifest, string fileName)
        {
            ManifestStepsFlyoutList.Children.Clear();
            ManifestStepsFlyoutTitle.Text = fileName;

            int total = manifest.ApiTests.Count + manifest.GraphTests.Count + manifest.PostGraphApiTests.Count
                      + manifest.ZohoTests.Count + manifest.PowerShellVerify.Count + manifest.UiSteps.Count;
            ManifestStepsFlyoutSubtitle.Text = string.IsNullOrWhiteSpace(manifest.Feature)
                ? $"{total} step(s)"
                : $"#{manifest.Issue} · {manifest.Feature} · {total} step(s)";

            AddHttpSection("API Tests", "BlueBrush", manifest.ApiTests);
            AddHttpSection("Graph Tests", "MauveBrush", manifest.GraphTests);
            AddHttpSection("Post-Graph API Tests", "BlueBrush", manifest.PostGraphApiTests);
            AddHttpSection("Zoho Tests", "GreenBrush", manifest.ZohoTests);

            if (manifest.PowerShellVerify.Count > 0)
            {
                ManifestStepsFlyoutList.Children.Add(MakeSectionHeader($"PowerShell Verify ({manifest.PowerShellVerify.Count})", "PeachBrush"));
                for (int i = 0; i < manifest.PowerShellVerify.Count; i++)
                    ManifestStepsFlyoutList.Children.Add(MakeStepRow(ManifestStepDescriber.DescribePowerShellEntry(manifest.PowerShellVerify[i], i)));
            }

            if (manifest.UiSteps.Count > 0)
            {
                ManifestStepsFlyoutList.Children.Add(MakeSectionHeader($"UI Steps ({manifest.UiSteps.Count})", "PeachBrush"));
                for (int i = 0; i < manifest.UiSteps.Count; i++)
                    ManifestStepsFlyoutList.Children.Add(MakeStepRow(ManifestStepDescriber.DescribeUiStep(manifest.UiSteps[i], i)));
            }

            if (total == 0)
                ManifestStepsFlyoutList.Children.Add(MakeStepRow("This manifest declares no steps."));
        }

        private void AddHttpSection(string title, string brushKey, List<System.Text.Json.JsonElement> entries)
        {
            if (entries.Count == 0) return;
            ManifestStepsFlyoutList.Children.Add(MakeSectionHeader($"{title} ({entries.Count})", brushKey));
            for (int i = 0; i < entries.Count; i++)
                ManifestStepsFlyoutList.Children.Add(MakeStepRow(ManifestStepDescriber.DescribeHttpEntry(entries[i], i)));
        }

        private TextBlock MakeSectionHeader(string text, string brushKey) => new TextBlock
        {
            Text = text,
            FontSize = 11,
            FontWeight = FontWeights.Bold,
            Foreground = (Brush)FindResource(brushKey),
            Margin = new Thickness(0, 8, 0, 4),
        };

        private Border MakeStepRow(string text) => new Border
        {
            Background = (Brush)FindResource("Surface0Brush"),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(6, 4, 6, 4),
            Margin = new Thickness(0, 0, 0, 3),
            Child = new TextBlock
            {
                Text = text,
                FontSize = 11,
                Foreground = (Brush)FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
            },
        };

        // Git #952 step-summarization (DescribeHttpEntry / DescribePowerShellEntry / DescribeUiStep /
        // DescribeCaptureResponse / GetJsonStr) now lives in the shared BuildConsole.Services.ManifestStepDescriber
        // so the manifest viewer's workflow-chart boxes label themselves identically — one source of truth.

        /// <summary>Returns the currently displayed view name.</summary>
        public string GetCurrentView() => _currentView;

        /// <summary>Switch the visible content panel based on the activity bar selection.</summary>
        public void SwitchView(string view)
        {
            _currentView = view;
            ChatsView.Visibility      = view == "Chats"      ? Visibility.Visible : Visibility.Collapsed;
            ExplorerView.Visibility   = view == "Explorer"   ? Visibility.Visible : Visibility.Collapsed;
            SearchView.Visibility     = view == "Search"     ? Visibility.Visible : Visibility.Collapsed;
            GitView.Visibility        = view == "Git"        ? Visibility.Visible : Visibility.Collapsed;
            IssuesView.Visibility     = view == "Issues"     ? Visibility.Visible : Visibility.Collapsed;
            SettingsView.Visibility   = view == "Settings"   ? Visibility.Visible : Visibility.Collapsed;
            AutomationView.Visibility = view == "Automation" ? Visibility.Visible : Visibility.Collapsed;

            HeaderTitle.Text = view == "Automation" ? "UI AUTOMATION" : (view == "Issues" ? "GIT BOARD" : view.ToUpperInvariant());

            // Adjust the New button tooltip to match the active view
            BtnNewItem.ToolTip = view switch
            {
                "Chats"      => "New Chat",
                "Explorer"   => "New File",
                "Search"     => "Search",
                "Git"        => "Commit",
                "Issues"     => "New Issue",
                "Automation" => "New Test",
                _            => "New"
            };

            // Git #863 — refresh icon only makes sense on the Git Board.
            BtnRefreshGitBoard.Visibility = view == "Issues" ? Visibility.Visible : Visibility.Collapsed;

            if (view == "Explorer" && ExplorerTree.Items.Count == 0)
            {
                LoadWorkspaceExplorer(RootWorkspacePath);
            }
            else if (view == "Git")
            {
                RefreshGitStatus();
            }
            else if (view == "Issues")
            {
                PopulateGitTrackerBoard();
            }
            else if (view == "Chats")
            {
                PopulateChatsTree();
            }
            else if (view == "Automation")
            {
                PopulateManifestsList();
            }
        }

        // ── GIT MILESTONES, EPICS & ISSUES ADHD TRACKER ─────────────────────
        // Git — Shane: "Feel free to change anything to patch how I actually
        // work based on the Add-In." This was 100% hardcoded demo data before;
        // now reads the SAME GET /extension/in-progress the browser
        // extension's left panel already polls, so this shows real
        // in-flight/complete/blocked/Shane-To-Do issues, not a fixed fake
        // board. There's no "milestone" concept in that endpoint's data (the
        // extension's own panel doesn't group by milestone either) — grouped
        // into Epics/Issues/Shane To-Do buckets instead, under one synthetic
        // "milestone" so the existing tree-rendering code below needs no
        // structural changes.
        private readonly List<GitMilestone> _milestones = new();

        // Git #839 (Git Board Phase 1) — _currentFilter tracks the active chip
        // so a 20s poll re-renders the same view; _boardShowsClosed marks when
        // the tree is holding the 🟢 Done (CLOSED) snapshot so leaving it for
        // any other chip reloads the default OPEN set. The board's own no-flash
        // content guard reuses the existing _lastInProgressSignature below.
        private string _currentFilter = "All";
        private bool _boardShowsClosed;

        // Git #821 — Shane: "can you stop all the flashing... every refresh
        // the left panel clears and rebuilds... so it flashes and sucks."
        // Both boards used to Items.Clear() + fully rebuild on EVERY 20s
        // poll regardless of whether anything actually changed - a
        // content-signature guard (cheap JSON serialize + string compare)
        // skips the rebuild entirely when the fetched data is identical to
        // what's already on screen, which is the overwhelming majority of
        // polls. Also preserves scroll position/expanded state on those
        // no-op polls, which a blind rebuild always threw away anyway.
        private string? _lastInProgressSignature;
        private string? _lastBoardSignature;

        /// <summary>
        /// Git #876 (reopened) — Shane: still crossing GitHub's 5,000/hour
        /// rate limit despite the earlier `EnrichBlockedStatusAsync` throttle.
        /// Second source found: #875's `GetMilestonesAsync()` (a real REST
        /// call) fired unconditionally on EVERY 20s `PopulateGitTrackerBoard`
        /// poll, right alongside `ListBoardIssuesAsync` — the existing
        /// `_lastInProgressSignature` guard only skips the tree REPAINT, not
        /// the network call itself, so this doubled the Git Board's real
        /// GitHub traffic to ~360 calls/hour whenever the Issues tab was
        /// open. Milestones (title/open/closed counts) change far less often
        /// than issue state, so a real GitHub fetch is now cached and reused
        /// for up to `MilestonesCacheTtl`, same wall-clock-throttle shape as
        /// `BlockedEnrichMinInterval` below. The explicit 🟢 Done chip click
        /// (`IssueFilter_Click`) intentionally bypasses this cache and always
        /// fetches fresh — it's a rare, deliberate user action, not a
        /// background poll.
        /// </summary>
        private List<GitHubApiClient.GitHubMilestoneInfo>? _cachedMilestoneInfos;
        private DateTime _lastMilestonesFetchUtc = DateTime.MinValue;
        private static readonly TimeSpan MilestonesCacheTtl = TimeSpan.FromMinutes(5);

        /// <summary>Git #923 — `forceFresh` skips the cache entirely (the manual Refresh button - a rare, deliberate click, not a background poll, same reasoning IssueFilter_Click's Done chip already gets).</summary>
        private async System.Threading.Tasks.Task<List<GitHubApiClient.GitHubMilestoneInfo>> GetMilestonesThrottledAsync(GitHubApiClient client, bool forceFresh = false)
        {
            if (!forceFresh && _cachedMilestoneInfos != null && DateTime.UtcNow - _lastMilestonesFetchUtc < MilestonesCacheTtl)
            {
                return _cachedMilestoneInfos;
            }

            _cachedMilestoneInfos = await client.GetMilestonesAsync();
            _lastMilestonesFetchUtc = DateTime.UtcNow;
            return _cachedMilestoneInfos;
        }

        /// <summary>
        /// Git #923 — Shane: "I had a chat delete a bunch of Milestones and
        /// merge other things... It's been a couple of minutes and the Git
        /// Board is not showing the changes." Two compounding bugs found:
        /// (1) the manual Refresh button (BtnRefreshGitBoard_Click) called
        /// this with no way to bypass #876's 5-minute milestone cache, so
        /// clicking Refresh genuinely did nothing for up to 5 minutes after
        /// a milestone-only change - `forceFresh` here is what that button
        /// now passes. (2) Even past that cache window, the repaint-skip
        /// signature below was computed from the OPEN ISSUES list only,
        /// never from milestoneInfos - a milestone with zero open issues
        /// (exactly what "delete a bunch of milestones" tends to be, see
        /// #884's whole reason for backfilling EMPTY milestones onto the
        /// board in the first place) changes nothing about any issue, so
        /// the old signature never moved and the stale board would have
        /// silently never repainted again, cache or no cache. Fixed by
        /// folding milestoneInfos into the same signature.
        /// </summary>
        public async void PopulateGitTrackerBoard(bool forceFresh = false)
        {
            // Git #839 — the 🟢 Done view is a manual CLOSED snapshot; let a
            // background poll leave it be rather than repaint OPEN over it.
            if (_boardShowsClosed && _currentFilter == "Done") return;

            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                IssuesTree.Items.Clear();
                IssueStatMilestones.Text = "0 Active";
                IssueStatEpics.Text = "0 Active";
                IssueStatOpen.Text = "0 Pending";
                IssueStatClosed.Text = "0 Done";
                IssuesTree.Items.Add(new TreeViewItem { Header = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings)." });
                return;
            }

            List<GitBoardIssue> issues;
            List<GitHubApiClient.GitHubMilestoneInfo> milestoneInfos;
            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                // Default Git Board = real OPEN issues only. Closed drop out of
                // view entirely ("done done get out of my view") and are
                // reachable solely via the 🟢 Done chip (IssueFilter_Click).
                issues = await client.ListBoardIssuesAsync(GitHubIssueState.Open);
                // Git #875 — real open/closed counts per milestone; the issue
                // list above is OPEN-only, so it can never supply a real
                // "closed" count on its own (see GitMilestone.HasRealCounts).
                // Git #876 (reopened) — throttled/cached, see GetMilestonesThrottledAsync.
                milestoneInfos = await GetMilestonesThrottledAsync(client, forceFresh);
                SyncError?.Invoke(this, null);
            }
            catch (Exception ex)
            {
                IssuesTree.Items.Clear();
                IssuesTree.Items.Add(new TreeViewItem { Header = $"Couldn't reach GitHub: {ex.Message}" });
                SyncError?.Invoke(this, $"Git Board: {ex.Message}");
                ActivityLog.Log("git-board.data", $"open-issue fetch FAILED: {ex.Message}");
                return;
            }

            ActivityLog.Log("git-board.data", $"loaded {issues.Count} open issue(s), {issues.Count(i => i.IsEpic)} epic(s)");

            _boardShowsClosed = false;
            // Git #923 — milestoneInfos folded in (Number/Title/counts per
            // milestone), not just the open-issues list - see this method's
            // own doc comment above for why issues alone missed milestone-
            // only changes (deletes/merges with no open-issue side effect).
            var signature = System.Text.Json.JsonSerializer.Serialize(new
            {
                Issues = issues.Select(i => new { i.Number, i.Title, i.State, i.SubIssueCount, i.MilestoneTitle }),
                Milestones = milestoneInfos.Select(m => new { m.Number, m.Title, m.OpenIssues, m.ClosedIssues }),
            });
            if (!forceFresh && signature == _lastInProgressSignature) return;
            _lastInProgressSignature = signature;

            BuildBoardFromGitHub(issues, milestoneInfos);
            // Feed Focus Mode the real issue→milestone map + milestone counts (this is the
            // OPEN board fetch; the closed-view BuildBoardFromGitHub call deliberately does NOT
            // feed, so the filter map isn't overwritten with closed-only issues).
            BuildConsole.Services.FocusModeService.Instance.UpdateBoardSnapshot(issues, milestoneInfos);
            RenderIssuesTree(_currentFilter == "Done" ? "All" : _currentFilter);

            // Git #845 (Git Board Phase 7) — the board's own GraphQL fetch above
            // has no issue-dependency data, so blocked state is enriched in a
            // second pass via the real REST blocked_by endpoint (bounded
            // concurrency so a board full of open issues doesn't hammer GitHub
            // all at once), then the tree repaints once with the real result.
            _ = EnrichBlockedStatusAsync(settings.GitHubPat);
        }

        /// <summary>
        /// Git #842 (Git Board Phase 4) — Shane: wire the dead "+" button to a
        /// real "New Issue" dialog. Creates the issue via `POST /issues`, then
        /// (optionally) attaches it under the chosen epic via the same real
        /// `POST /issues/{parent}/sub_issues` endpoint #844's "Assign to
        /// Epic..." and exception-github-sync.ts both already use, and
        /// refreshes the board on success. Epic candidates come from
        /// <see cref="_lastBoardIssues"/> — the board's own last GraphQL fetch
        /// — same as #844/#845's pickers, no second GitHub round-trip.
        /// </summary>
        private async System.Threading.Tasks.Task CreateNewIssueAsync()
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ToastEngine.Warning("New Issue", "No GitHub PAT configured — set one in Settings (cog icon / File > Settings) first.");
                return;
            }

            var epicCandidates = _lastBoardIssues.Where(i => i.IsEpic).OrderByDescending(i => i.Number).ToList();
            var dialog = new NewIssueDialog(epicCandidates);
            if (dialog.ShowDialog() != true) return;

            var client = new GitHubApiClient(settings.GitHubPat);
            CreatedIssue created;
            try
            {
                created = await client.CreateIssueAsync(dialog.IssueTitle, dialog.IssueBody);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("git-board.create", $"issue creation FAILED: {ex.Message}");
                ToastEngine.Error("New Issue", $"Couldn't create the issue: {ex.Message}");
                return;
            }

            ActivityLog.Log("git-board.create", $"created #{created.Number} \"{dialog.IssueTitle}\"");

            if (dialog.SelectedEpicNumber.HasValue)
            {
                try
                {
                    await client.AddSubIssueAsync(dialog.SelectedEpicNumber.Value, created.Id);
                    ActivityLog.Log("git-board.create", $"#{created.Number} assigned under epic #{dialog.SelectedEpicNumber}");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.create", $"#{created.Number} -> epic #{dialog.SelectedEpicNumber} attach FAILED: {ex.Message}");
                    ToastEngine.Warning("New Issue", $"Issue #{created.Number} was created, but couldn't be attached under epic #{dialog.SelectedEpicNumber}: {ex.Message}");
                }
            }

            _lastInProgressSignature = null;
            PopulateGitTrackerBoard();
        }

        /// <summary>
        /// Git #876 — Shane: "Something is causing a git refresh a lot and I
        /// am being rate limited quickly." This is that something: one real
        /// REST call PER open issue (GetOpenBlockedByAsync), not one call
        /// total, re-run in full on EVERY PopulateGitTrackerBoard() whose
        /// GraphQL signature changed - and that signature changes on ANY
        /// open issue's number/title/state/subIssueCount/milestone across a
        /// repo with dozens of concurrent sessions actively filing/editing/
        /// labeling issues (this repo, today). A board with 40-80 open
        /// issues could burst 40-80 REST calls every ~20s, on top of every
        /// other tool (gh CLI, other sessions) sharing the same account's
        /// hourly rate limit. Throttled to at most once per
        /// BlockedEnrichMinInterval regardless of how often the caller asks
        /// - the badge can be up to that stale, which is a fair trade for
        /// not burning the shared rate limit on redundant re-checks of
        /// issues whose blocked state almost never actually changes minute
        /// to minute.
        /// </summary>
        private DateTime _lastBlockedEnrichUtc = DateTime.MinValue;
        private static readonly TimeSpan BlockedEnrichMinInterval = TimeSpan.FromMinutes(3);

        private async System.Threading.Tasks.Task EnrichBlockedStatusAsync(string pat)
        {
            if (DateTime.UtcNow - _lastBlockedEnrichUtc < BlockedEnrichMinInterval) return;
            _lastBlockedEnrichUtc = DateTime.UtcNow;

            var openIssues = _milestones.SelectMany(m => m.Epics).SelectMany(e => e.Issues)
                .Where(i => i.Status != "CLOSED").ToList();
            if (openIssues.Count == 0) return;

            var client = new GitHubApiClient(pat);
            using var gate = new System.Threading.SemaphoreSlim(6);

            await System.Threading.Tasks.Task.WhenAll(openIssues.Select(async issue =>
            {
                await gate.WaitAsync();
                try
                {
                    var blocker = await client.GetOpenBlockedByAsync(issue.IssueNumber);
                    issue.IsBlocked = blocker != null;
                    issue.BlockedByNumber = blocker?.Number;
                    issue.BlockedByTitle = blocker?.Title;
                }
                catch { /* best-effort — worst case this one issue just doesn't show a Blocked badge */ }
                finally { gate.Release(); }
            }));

            RenderIssuesTree(_currentFilter == "Done" ? "All" : _currentFilter);
        }

        /// <summary>
        /// Git #839 — turns the real GitHub issue list into the existing
        /// milestone → bucket → issue tree model. Grouped by the real GitHub
        /// Milestone (issues with none fall under "No Milestone"); within each,
        /// split into Epics (any issue with sub-issues), plain Issues, and
        /// Shane To-Do (the label). Status carried through is the real issue
        /// state, never a label.
        /// </summary>
        /// <summary>Git #844 — the last-fetched real open issues, kept around so "Assign to Epic..." can build its picker (real open issues that ARE epics) from data already in memory instead of a second GitHub round-trip.</summary>
        private List<GitBoardIssue> _lastBoardIssues = new();

        /// <summary>Git #921 (Epic #803) — the board's own last real open-issue fetch, so a detail tab can resolve a clicked/linked issue number (its title, epic-ness, To-Do status, linked epic) without a second GitHub round-trip. Read-only view; mutation stays inside BuildBoardFromGitHub.</summary>
        public IReadOnlyList<GitBoardIssue> CurrentBoardIssues => _lastBoardIssues;

        // ── Universal title-bar search — read-only views over the SAME in-memory
        //    source lists the sidebar trees already render, so the search reads
        //    real live data instead of building any parallel index. ─────────────

        /// <summary>The last real chat board fetch (polled every 20s in Initialize regardless of view). The title-bar search matches these and navigates via MainWindow.OpenChatTab.</summary>
        public IReadOnlyList<BoardChat> CurrentBoardChats => _lastBoardChats;

        /// <summary>The real GitHub milestones the Git Board built (fully-populated Epics), so the search can jump straight into MainWindow.OpenMilestoneDetailTab.</summary>
        public IReadOnlyList<GitMilestone> CurrentMilestones => _milestones;

        /// <summary>Focus Mode — re-render the Git Board and Chats tree from the already-fetched
        /// caches so the active-milestone hard filter applies immediately (no network hit). Called
        /// by MainWindow whenever focus is turned on/off or its milestone changes.</summary>
        public void ReapplyFocusFilter()
        {
            var focus = BuildConsole.Services.FocusModeService.Instance;

            // Git Board — re-render straight from the cached milestones so the active-milestone
            // hard filter (RenderIssuesTree's IsMilestoneInFocus) applies immediately, no network hit.
            try { RenderIssuesTree(_currentFilter == "Done" ? "All" : _currentFilter); } catch { }

            // Chats — MUST call RenderChatsTree directly (renders from _lastBoardChats), NOT
            // PopulateChatsTree. The latter re-fetches the board and early-returns at its
            // unchanged-data signature guard, so on a focus toggle (board data identical, only the
            // filter changed) RenderChatsTree — and thus IsChatInFocus — never ran. THAT was the
            // live bug: the header counted "N hidden" correctly while the tree stayed unfiltered.
            try { RenderChatsTree(); } catch { }

            // Per-panel focus diagnostics on the focus-mode channel: how many known items the filter
            // is hiding vs showing, so a future regression is instantly visible by comparing this
            // against what actually rendered. Logged on both the activate and deactivate transitions.
            try
            {
                int msTotal = _milestones.Count;
                int msShown = _milestones.Count(m => focus.IsMilestoneInFocus(m.GithubNumber, m.Title));
                int chTotal = _lastBoardChats.Count;
                int chShown = _lastBoardChats.Count(c => focus.IsChatInFocus(c));
                BuildConsole.Services.ActivityLog.Log("focus-mode",
                    focus.IsActive
                        ? $"filter applied — Git Board {msShown}/{msTotal} milestone(s) shown ({msTotal - msShown} hidden); Chats {chShown}/{chTotal} chat(s) shown ({chTotal - chShown} hidden)"
                        : $"filter cleared — Git Board {msTotal} milestone(s) + Chats {chTotal} chat(s) all shown");
            }
            catch { }
        }

        /// <summary>The enumerated test manifests backing ManifestFilesTree (area, file name, and the resolved absolute path for MainWindow.OpenFileTab). Projected from the private <see cref="_manifestEntries"/> so the search never re-scans disk itself.</summary>
        public IReadOnlyList<(string Area, string FileName, string FullPath)> CurrentManifests =>
            _manifestEntries
                .Select(e => (e.Area, e.FileName,
                              Path.Combine(RootWorkspacePath, "test-manifests", e.RelativePath)))
                .ToList();

        /// <summary>Universal search warm-up: ensure the in-memory sources the title-bar search reads are populated. Manifests are a cheap synchronous disk scan; the Git Board only auto-polls while its own view is visible (#863), so warm it here when empty. Chats already poll every 20s regardless of view, but are warmed too if still empty. All reuse the real Populate* paths — no separate index.</summary>
        public void WarmSearchSources()
        {
            if (_manifestEntries.Count == 0) PopulateManifestsList();

            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            if (_lastBoardIssues.Count == 0 && settings.HasGitHubPat)
                PopulateGitTrackerBoard();
            if (_lastBoardChats.Count == 0 && _api != null && _api.IsConfigured)
                PopulateChatsTree();
        }

        /// <summary>Git #921 (Epic #803) — map a real board issue number to the same <see cref="GitIssue"/> display shape the tree nodes carry (identical mapping to MapBucket), so MainWindow's tab-to-tab navigation resolves numbers to detail tabs from cached data. Null when the number isn't on the current OPEN board (MainWindow then falls back to a live GetIssueAsync fetch).</summary>
        public GitIssue? BuildDetailIssue(int number)
        {
            var it = _lastBoardIssues.FirstOrDefault(i => i.Number == number);
            if (it == null) return null;
            return new GitIssue
            {
                IssueNumber = it.Number,
                Title = it.IsEpic ? $"{it.Title}  ({it.SubIssueCount} sub)" : it.Title,
                RawTitle = it.Title,
                Priority = it.IsTodo ? "HIGH" : "MED",
                Status = it.IsClosed ? "CLOSED" : "OPEN",
                Body = it.Body,
                DatabaseId = it.DatabaseId,
                IsEpic = it.IsEpic,
            };
        }

        private void BuildBoardFromGitHub(List<GitBoardIssue> issues, List<GitHubApiClient.GitHubMilestoneInfo> milestoneInfos)
        {
            _lastBoardIssues = issues;
            _milestones.Clear();

            var milestoneInfoByNumber = milestoneInfos.ToDictionary(mi => mi.Number);

            static string? DeriveSqlPath(string body)
            {
                if (string.IsNullOrEmpty(body)) return null;
                var m = System.Text.RegularExpressions.Regex.Match(body, @"lib/db/migrations/manual/[^\s""'`)\]]+\.sql");
                return m.Success ? m.Value : null;
            }

            GitEpic MapBucket(string title, string colorHex, IEnumerable<GitBoardIssue> src)
            {
                var epic = new GitEpic { Title = title, ColorHex = colorHex };
                foreach (var it in src.OrderByDescending(i => i.Number))
                {
                    epic.Issues.Add(new GitIssue
                    {
                        IssueNumber = it.Number,
                        Title = it.IsEpic ? $"{it.Title}  ({it.SubIssueCount} sub)" : it.Title,
                        RawTitle = it.Title,
                        Priority = it.IsTodo ? "HIGH" : "MED",
                        Status = it.IsClosed ? "CLOSED" : "OPEN",
                        SqlPath = DeriveSqlPath(it.Body),
                        Body = it.Body,
                        DatabaseId = it.DatabaseId,
                        IsEpic = it.IsEpic,
                    });
                }
                return epic;
            }

            var groups = issues
                .GroupBy(i => i.MilestoneTitle)
                .OrderBy(g => g.Key == null ? 1 : 0)
                .ThenBy(g => g.Key);

            // Git #884 — Shane: "The Git Board is not showing me all the
            // milestones.... even empty ones need to appear." `groups` above
            // is built entirely from the OPEN-only issue fetch, so a
            // milestone with zero open issues under it (everything closed,
            // or genuinely nothing assigned yet) never gets a group at all —
            // it was invisible regardless of how real/active it is on
            // GitHub. Tracked here so the pass below can add the ones that
            // never showed up in `groups`.
            var seenMilestoneNumbers = new HashSet<int>();

            foreach (var g in groups)
            {
                var list = g.ToList();
                var milestone = new GitMilestone { Title = g.Key ?? "No Milestone" };
                var epicsBucket = MapBucket("⚡ Epics", "#89B4FA", list.Where(i => i.IsEpic && !i.IsTodo));
                var issuesBucket = MapBucket("⚡ Issues", "#A6E3A1", list.Where(i => !i.IsEpic && !i.IsTodo));
                var todoBucket = MapBucket("⚡ Shane To-Do", "#F5C2E7", list.Where(i => i.IsTodo));
                if (epicsBucket.Issues.Count > 0) milestone.Epics.Add(epicsBucket);
                if (issuesBucket.Issues.Count > 0) milestone.Epics.Add(issuesBucket);
                if (todoBucket.Issues.Count > 0) milestone.Epics.Add(todoBucket);

                // Git #875 — `list` here is OPEN-only (see the fetch above), so
                // it can never contain a closed issue to count. Real completed/
                // total comes from GitHub's own milestone object instead, keyed
                // by the group's real milestone number (shared by every issue in
                // it). The synthetic "No Milestone" bucket has no such number —
                // HasRealCounts stays false and CreateMilestoneHeader hides the
                // badge rather than showing a fabricated total.
                var milestoneNumber = list.FirstOrDefault()?.MilestoneNumber;
                if (milestoneNumber.HasValue && milestoneInfoByNumber.TryGetValue(milestoneNumber.Value, out var info))
                {
                    milestone.TotalCount = info.OpenIssues + info.ClosedIssues;
                    milestone.CompletedCount = info.ClosedIssues;
                    milestone.HasRealCounts = true;
                    // Git #921 — carry the real number + raw open/closed counts so the milestone detail tab shows them as separate pills.
                    milestone.GithubNumber = milestoneNumber.Value;
                    milestone.OpenIssues = info.OpenIssues;
                    milestone.ClosedIssues = info.ClosedIssues;
                    seenMilestoneNumbers.Add(milestoneNumber.Value);
                }
                else
                {
                    milestone.TotalCount = list.Count;
                    milestone.CompletedCount = 0;
                    milestone.HasRealCounts = false;
                }

                if (milestone.Epics.Count > 0) _milestones.Add(milestone);
            }

            // Git #884 — every real GitHub milestone that had no open issues
            // to form a group above still gets a node: empty (no epic/issue
            // buckets under it — there's nothing OPEN to show), but visible,
            // with its real closed/total count so a fully-completed milestone
            // reads as "100% (12/12)" rather than not existing at all.
            foreach (var mi in milestoneInfos)
            {
                if (seenMilestoneNumbers.Contains(mi.Number)) continue;
                _milestones.Add(new GitMilestone
                {
                    Title = mi.Title,
                    TotalCount = mi.OpenIssues + mi.ClosedIssues,
                    CompletedCount = mi.ClosedIssues,
                    HasRealCounts = true,
                    // Git #921 — same real number + raw counts for milestones with no open issues (they still get a clickable tab).
                    GithubNumber = mi.Number,
                    OpenIssues = mi.OpenIssues,
                    ClosedIssues = mi.ClosedIssues,
                });
            }

            // Re-sort now that #884's pass may have appended milestones out
            // of order — same ordering `groups` used above (alphabetical,
            // "No Milestone" pinned last).
            _milestones.Sort((a, b) =>
            {
                bool aNone = a.Title == "No Milestone", bNone = b.Title == "No Milestone";
                if (aNone != bNone) return aNone ? 1 : -1;
                return string.Compare(a.Title, b.Title, StringComparison.OrdinalIgnoreCase);
            });
        }

        // ── CHATS (real GET /extension/board — grouped by linked epic) ──────
        // Chats tree redesign — Shane: the Chats tree was "hard to see, read,
        // navigate" while every other panel is "pretty, easy, tight, legible."
        // Rebuilt to mirror the UI Automation manifest tree (#984, his stated
        // favourite panel): each epic group now gets its OWN stable palette
        // colour (a coloured chip + accent-coloured title + a real chat-count
        // badge) instead of every epic sharing one BlueBrush, its chat leaves
        // carry a thin epic-coloured left bar (so the whole group reads as one
        // colour without tinting the title text itself), groups stay collapsed
        // by default (#885), and the search box above the tree filters it live
        // (matching epics auto-expand, non-matching drop out) — the exact same
        // shape #984's RenderManifestTree / MakeAreaHeader / MakeLeafHeader use.
        //
        // The network fetch stays here in PopulateChatsTree; the actual tree
        // BUILD moved into RenderChatsTree so the search box (ChatSearch_
        // TextChanged) can re-render from the cached board (_lastBoardChats +
        // _chatEpicById) without re-hitting the dev server — same split #984
        // uses between PopulateManifestsList and RenderManifestTree.
        public async void PopulateChatsTree()
        {
            if (_api == null || !_api.IsConfigured)
            {
                _lastBoardChats = new();
                ShowChatsMessage("Not connected — see Settings");
                return;
            }

            BoardResponse board;
            bool isStale;
            DateTime? cachedAtUtc;
            try
            {
                // Git #931 — falls back to the local cache when the dev
                // server's unreachable (IsStale=true) instead of throwing;
                // this catch now only fires when there's NO cache either
                // (e.g. the very first run before anything ever succeeded).
                var result = await _api.GetBoardAsync();
                board = result.Data;
                isStale = result.IsStale;
                cachedAtUtc = result.CachedAtUtc;
                SyncError?.Invoke(this, isStale
                    ? $"Chats: showing cached data from {result.CachedAtUtc?.ToLocalTime():g} — dev server unreachable"
                    : null);
            }
            catch (Exception ex)
            {
                ShowChatsMessage($"Couldn't reach the API: {ex.Message}");
                SyncError?.Invoke(this, $"Chats: {ex.Message}");
                return;
            }

            // Git #851 — cached even when the signature is unchanged below
            // (that check only guards the TREE rebuild) so BuildQueuePanel's
            // "open the chat for this issue" click always has the latest
            // real chat list to search, not just whatever happened to be
            // cached the last time the tree actually re-rendered.
            _lastBoardChats = board.Chats;
            _chatEpicById = board.Epics.ToDictionary(e => e.Id);
            // Focus Mode needs chats + epic→issue-number to resolve a chat's milestone.
            BuildConsole.Services.FocusModeService.Instance.UpdateChatSnapshot(board.Chats, _chatEpicById);
            _chatsIsStale = isStale;
            _chatsCachedAtUtc = cachedAtUtc;

            // Git #931 — the stale/offline state itself is part of what's
            // "changed" for repaint purposes: going stale->live (or the
            // reverse) should always repaint even if the underlying board
            // data happens to be byte-identical to what's already shown.
            var signature = isStale + "|" + System.Text.Json.JsonSerializer.Serialize(board);
            if (signature == _lastBoardSignature) return;
            _lastBoardSignature = signature;

            RenderChatsTree();
        }

        /// <summary>Chats redesign — the connection/error placeholder path. Kept
        /// separate from <see cref="RenderChatsTree"/> (which renders real board
        /// data) so both share the tree-clearing + title-block reset discipline,
        /// and so the signature is nulled to force a real repaint once the board
        /// is reachable again.</summary>
        private void ShowChatsMessage(string message)
        {
            _chatTitleBlocks.Clear();
            ChatsTree.Items.Clear();
            ChatsTree.Items.Add(new TreeViewItem { Header = message, Foreground = GetBrush("Subtext1Brush") });
            if (TxtNoChats != null) TxtNoChats.Visibility = Visibility.Collapsed;
            _lastBoardSignature = null;
        }

        /// <summary>Chats redesign (mirrors #984's RenderManifestTree) — (re)builds
        /// the Chats TreeView from the cached board (<see cref="_lastBoardChats"/> +
        /// <see cref="_chatEpicById"/>), applying the current <see cref="ChatSearch"/>
        /// text. Epics are colour-coded per epic (a stable hash of the title, so a
        /// given epic keeps its colour regardless of which others are present),
        /// sorted alphabetically for a stable top-level index with the synthetic
        /// "Unlinked" bucket pinned last; leaves sort newest-first. Groups are
        /// collapsed by default; while searching, epics with a match auto-expand and
        /// non-matching epics/leaves drop out (an epic whose own title matches shows
        /// all of its chats).</summary>
        private void RenderChatsTree()
        {
            if (ChatsTree == null) return;

            // Fully rebuilt on every render, so drop the previous build's
            // registered title blocks before the builders below re-register
            // the current ones (#932's MaxWidth trimming mechanism).
            _chatTitleBlocks.Clear();
            ChatsTree.Items.Clear();

            string search = (ChatSearch?.Text ?? "").Trim();
            bool searching = search.Length > 0;

            if (_chatsIsStale)
            {
                ChatsTree.Items.Add(new TreeViewItem
                {
                    Header = $"⚠ Offline — showing cached chats from {_chatsCachedAtUtc?.ToLocalTime():MMM d, h:mm tt}",
                    Foreground = GetBrush("PeachBrush"),
                    IsHitTestVisible = false,
                    Focusable = false,
                });
            }

            var epicById = _chatEpicById;
            // Focus Mode — hard-hide chats that don't belong to the active milestone
            // (resolved via the chat's issue / epic issue number). Off-focus = all chats.
            var focusChats = _lastBoardChats
                .Where(c => BuildConsole.Services.FocusModeService.Instance.IsChatInFocus(c))
                .ToList();
            var byEpic = focusChats.Where(c => c.EpicId.HasValue).GroupBy(c => c.EpicId!.Value);
            var unlinked = focusChats.Where(c => !c.EpicId.HasValue).ToList();

            // Build (title, chats) groups: real epics first, sorted alphabetically
            // (a stable top-level index, exactly like #984's alphabetical areas),
            // with "Unlinked" pinned last as the no-category bucket.
            var groups = new List<(string Title, List<BoardChat> Chats)>();
            foreach (var grp in byEpic)
            {
                var title = epicById.TryGetValue(grp.Key, out var epic) ? epic.Title : $"Epic #{grp.Key}";
                groups.Add((title, grp.OrderByDescending(c => c.UpdatedAt).ToList()));
            }
            groups.Sort((a, b) => string.Compare(a.Title, b.Title, StringComparison.OrdinalIgnoreCase));
            if (unlinked.Count > 0)
                groups.Add(("Unlinked", unlinked.OrderByDescending(c => c.UpdatedAt).ToList()));

            int shown = 0;
            foreach (var (title, chats) in groups)
            {
                bool epicMatches = searching && title.Contains(search, StringComparison.OrdinalIgnoreCase);
                var leaves = chats
                    .Where(c => !searching || epicMatches
                                || (c.Title ?? "").Contains(search, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                if (leaves.Count == 0) continue;

                // Colour by epic title (same stable-hash convention #984 uses for
                // areas — see AreaBrushKey), so an epic keeps its colour session
                // to session regardless of which other epics happen to be present.
                string brushKey = AreaBrushKey(title);
                var epicItem = BuildChatEpicHeader(title, leaves.Count, brushKey, searching);
                foreach (var chat in leaves) epicItem.Items.Add(BuildChatLeaf(chat, brushKey));
                ChatsTree.Items.Add(epicItem);
                shown += leaves.Count;
            }

            bool empty = shown == 0;
            if (TxtNoChats != null)
            {
                TxtNoChats.Visibility = empty && !_chatsIsStale ? Visibility.Visible : Visibility.Collapsed;
                TxtNoChats.Text = searching && empty
                    ? $"No chats match \"{search}\"."
                    : "No chats linked yet.";
            }

            // #932 — now that every title block for this build is registered, apply
            // the explicit MaxWidth constraint against the tree's current width so
            // CharacterEllipsis trimming actually engages (long chat/epic titles
            // still overflow this narrow tree — exactly what #885/#924/#932 fought,
            // so the proven MaxWidth mechanism is kept under the new look).
            ApplyChatTitleMaxWidths();
        }

        /// <summary>Chats redesign (mirrors #984's MakeAreaHeader) — a colour-coded
        /// epic row: an 8×8 rounded colour chip, the epic title in that epic's accent
        /// colour, and a muted chat-count badge (e.g. "War Room  (6)"). The title is
        /// registered for #932's explicit-MaxWidth trimming.</summary>
        private TreeViewItem BuildChatEpicHeader(string title, int chatCount, string brushKey, bool searching)
        {
            var brush = GetBrush(brushKey);
            var sp = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 4) };

            sp.Children.Add(new Border
            {
                Width = 9,
                Height = 9,
                CornerRadius = new CornerRadius(2),
                Background = brush,
                Margin = new Thickness(0, 0, 7, 0),
                VerticalAlignment = VerticalAlignment.Center,
            });

            var titleBlock = new TextBlock
            {
                Text = title,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                Foreground = brush,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            sp.Children.Add(titleBlock);
            _chatTitleBlocks.Add((titleBlock, EpicTitleWidthReserve));

            sp.Children.Add(new TextBlock
            {
                Text = $" ({chatCount})",
                FontSize = 11,
                Foreground = GetBrush("Subtext0Brush"),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(4, 0, 0, 0),
            });

            // Collapsed by default (#885); a search auto-expands matching epics (#984).
            return new TreeViewItem
            {
                Header = sp,
                IsExpanded = searching,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                Margin = new Thickness(0, 2, 0, 2),
            };
        }

        /// <summary>Chats redesign (mirrors #984's MakeLeafHeader) — a chat leaf with a
        /// thin epic-coloured left bar + the chat title in muted Subtext1Brush. Title
        /// registered for #932's MaxWidth trim. Retains #828's "Assign to Epic..."
        /// right-click, now sourcing its epic list from the cached <see cref="_chatEpicById"/>
        /// instead of the fetch's board.Epics (identical data, no second round-trip).</summary>
        private TreeViewItem BuildChatLeaf(BoardChat chat, string brushKey)
        {
            var dp = new DockPanel { Margin = new Thickness(0, 2, 0, 2) };

            dp.Children.Add(new Border
            {
                Width = 3,
                CornerRadius = new CornerRadius(1),
                Background = GetBrush(brushKey),
                Margin = new Thickness(0, 1, 7, 1),
            }); // DockPanel.Dock defaults to Left → a full-height vertical bar

            var titleBlock = new TextBlock
            {
                Text = chat.Title,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = GetBrush("Subtext1Brush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            dp.Children.Add(titleBlock);

            // #932 — a chat leaf sits one level deeper than an epic header, so it
            // reserves an extra ~19px of tree indentation on top of its own expander
            // column; register it with the larger leaf reserve.
            _chatTitleBlocks.Add((titleBlock, LeafTitleWidthReserve));

            var tvi = new TreeViewItem
            {
                Header = dp,
                Tag = chat,
                HorizontalContentAlignment = HorizontalAlignment.Stretch,
                Margin = new Thickness(0, 1, 0, 1),
            };

            // Git #828 — Shane: "I need a way to assign a chat to an epic in the WPF
            // app." Same POST /chats/ingest the extension's own "link this chat to
            // that epic" click already uses (Git #781), just reached from here.
            var cm = new ContextMenu();
            var miAssign = new MenuItem { Header = "Assign to Epic..." };
            miAssign.Click += async (_, _) =>
            {
                if (_api == null) return;
                var dialog = new AssignEpicDialog(chat.Title, _chatEpicById.Values.ToList());
                if (dialog.ShowDialog() != true || dialog.SelectedEpicId == null) return;
                try
                {
                    var res = await _api.LinkChatToEpicAsync(chat.ConversationId, dialog.SelectedEpicId.Value);
                    if (!res.IsSuccessStatusCode)
                    {
                        var body = await res.Content.ReadAsStringAsync();
                        ToastEngine.Error("Assign to Epic", $"Couldn't assign: {body}");
                        return;
                    }
                    _lastBoardSignature = null;
                    PopulateChatsTree();
                }
                catch (System.Exception ex)
                {
                    ToastEngine.Error("Assign to Epic", $"Couldn't assign: {ex.Message}");
                }
            };
            cm.Items.Add(miAssign);

            if (chat.EpicId.HasValue)
            {
                var formerEpicId = chat.EpicId.Value;
                var formerEpicTitle = _chatEpicById.TryGetValue(formerEpicId, out var formerEpic) ? formerEpic.Title : $"Epic #{formerEpicId}";
                var miUnassign = new MenuItem { Header = "Unassign from Epic" };
                miUnassign.Click += async (_, _) =>
                {
                    if (_api == null) return;
                    try
                    {
                        var res = await _api.UnlinkChatFromEpicAsync(chat.ConversationId);
                        if (!res.IsSuccessStatusCode)
                        {
                            var body = await res.Content.ReadAsStringAsync();
                            ActivityLog.Log("git-board.assign-chat", $"unassign chat {chat.ConversationId} from epic \"{formerEpicTitle}\" (id {formerEpicId}) FAILED: HTTP {(int)res.StatusCode} {body}");
                            ToastEngine.Error("Unassign from Epic", $"Couldn't unassign: {body}");
                            return;
                        }
                        ActivityLog.Log("git-board.assign-chat", $"unassigned chat {chat.ConversationId} ({chat.Title}) from epic \"{formerEpicTitle}\" (id {formerEpicId})");
                        _lastBoardSignature = null;
                        PopulateChatsTree();
                    }
                    catch (System.Exception ex)
                    {
                        ActivityLog.Log("git-board.assign-chat", $"unassign chat {chat.ConversationId} from epic \"{formerEpicTitle}\" (id {formerEpicId}) FAILED: {ex.Message}");
                        ToastEngine.Error("Unassign from Epic", $"Couldn't unassign: {ex.Message}");
                    }
                };
                cm.Items.Add(miUnassign);
            }

            tvi.ContextMenu = cm;

            return tvi;
        }

        private void ChatSearch_TextChanged(object sender, TextChangedEventArgs e) => RenderChatsTree();

        // Git #932 — the Chats tree's CharacterEllipsis trimming (from #885)
        // never engaged visually: a TreeViewItem with HorizontalContentAlignment
        // = Stretch still measures its header content with effectively unbounded
        // available width in the default template's Auto measure pass, so the
        // title TextBlock always sized to its full single-line width and clipped
        // (the wrapping ScrollViewer has HorizontalScrollBarVisibility=Disabled)
        // instead of trimming. Rather than fight the ancestor-width propagation a
        // third time (#885 on this tree, #924 on the right panel), each title
        // block is given an explicit numeric MaxWidth derived from
        // ChatsTree.ActualWidth — an explicit MaxWidth forces trimming to engage
        // regardless of what any ancestor's Stretch/Auto measurement resolves to.
        //
        // Reserve = everything ON THE SAME ROW as the title that is NOT the title,
        // inside the tree's width (redesign updates these for the new #984-style
        // chip / count-badge / left-bar layout — the title now also reserves the
        // count badge sitting to its RIGHT so the badge stays on-screen):
        //   Epic header (depth 0): 19px expander column + ~16px colour-chip column
        //     (9px chip + 7px right margin) + ~34px trailing count badge
        //     (" (12)" @ 11px) + ~2px tree padding/border + a small safety buffer
        //     ->  ~74px.
        //   Chat leaf (depth 1): an extra ~19px of tree indentation (one nesting
        //     level) on top of its own 19px expander column, plus a ~10px left-bar
        //     column (3px bar + 7px right margin) + padding + buffer  ->  ~52px.
        // ChatsTree.ActualWidth is the TreeView's viewport width, which already
        // excludes the vertical scrollbar when it appears, so no extra scrollbar
        // subtraction is needed. Over-reserving only trims a few px early (safe);
        // under-reserving would re-introduce the overflow, so the reserves lean
        // conservative.
        private const double EpicTitleWidthReserve = 74;
        private const double LeafTitleWidthReserve = 52;
        private const double MinTitleWidth = 24;

        private readonly List<(TextBlock block, double reserve)> _chatTitleBlocks = new();

        private void ApplyChatTitleMaxWidths()
        {
            var available = ChatsTree.ActualWidth;
            foreach (var (block, reserve) in _chatTitleBlocks)
            {
                block.MaxWidth = Math.Max(MinTitleWidth, available - reserve);
            }
        }

        // Git #932 — the sidebar can be resized or collapsed/pinned, so recompute
        // the title MaxWidths whenever the tree's width actually changes. Height-
        // only changes (e.g. expanding an epic) are ignored to avoid needless work.
        private void ChatsTree_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyChatTitleMaxWidths();
        }

        private Dictionary<int, BoardEpic> _chatEpicById = new();
        private List<BoardChat> _lastBoardChats = new();

        // Chats redesign — the last fetch's stale/offline state + cache timestamp,
        // held so RenderChatsTree (invoked by the search box, not just the fetch)
        // can re-render the "⚠ Offline — cached chats from …" banner without a
        // re-fetch. Mirrors how #984's _manifestEntries lets its search re-render
        // the tree from cached data.
        private bool _chatsIsStale;
        private DateTime? _chatsCachedAtUtc;

        /// <summary>Git #829 — MainWindow needs the real epic TITLE (not just its id) for the right panel's "Issues in this epic" header; reuses the same lookup PopulateChatsTree already built rather than a second fetch.</summary>
        public string? GetEpicTitle(int epicId) => _chatEpicById.TryGetValue(epicId, out var epic) ? epic.Title : null;

        /// <summary>Git #910 — the epic's real GitHub issue number, so BuildQueuePanel can fetch its real sub-issues directly (GetSubIssuesAsync) instead of the disconnected internal bt_issues.epic_id table.</summary>
        public int? GetEpicGithubNumber(int epicId) => _chatEpicById.TryGetValue(epicId, out var epic) ? epic.GithubNumber : null;

        /// <summary>
        /// Git #851 — Shane: "When clicking on an In-Flight Still Open
        /// issue, it should open the chat that is associated to that
        /// issue." A chat can be linked to the issue directly
        /// (IssueGithubNumber) or via its epic (EpicId -> that epic's own
        /// GithubNumber) - checks both, same two paths ChatsTree_
        /// SelectedItemChanged already resolves the other direction. Null
        /// means no chat has ever been linked to this issue/epic yet.
        /// </summary>
        public BoardChat? FindChatForIssue(int githubNumber)
        {
            var direct = _lastBoardChats.FirstOrDefault(c => c.IssueGithubNumber == githubNumber);
            if (direct != null) return direct;

            var epic = _chatEpicById.Values.FirstOrDefault(e => e.GithubNumber == githubNumber);
            if (epic == null) return null;
            return _lastBoardChats.FirstOrDefault(c => c.EpicId == epic.Id);
        }

        private void ChatsTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is BoardChat chat && !string.IsNullOrEmpty(chat.ClaudeUrl))
            {
                int? githubNumber = chat.IssueGithubNumber
                    ?? (chat.EpicId.HasValue && _chatEpicById.TryGetValue(chat.EpicId.Value, out var epic) ? epic.GithubNumber : null);
                ChatSelected?.Invoke(this, (chat, githubNumber));
            }
        }

        /// <summary>
        /// Git #840 (Git Board Phase 2) — clicking an issue node shows its real
        /// description/comments in MainWindow's detail panel.
        /// Git #921 (Epic #803) — additively, clicking a milestone/epic/issue now
        /// also opens (or focuses) its native ADHD-friendly detail tab. The
        /// milestone header was untagged before #921 (a click did nothing); the
        /// epic/issue side-panel behaviour is deliberately preserved — the tab is
        /// on top of it, not instead of it.
        /// </summary>
        private void IssuesTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is not TreeViewItem tvi) return;

            if (tvi.Tag is GitMilestone milestone)
            {
                MilestoneTabRequested?.Invoke(this, milestone);
            }
            else if (tvi.Tag is GitIssue issue)
            {
                // Quick-glance side panel (#840) stays; the detail tab (#921) is additive.
                IssueSelected?.Invoke(this, issue);
                GitDetailTabRequested?.Invoke(this, issue);
            }
        }

        /// <summary>
        /// Git #873 — Shane: "every time it refreshes it re-expands all the
        /// tree nodes I had collapsed." RenderIssuesTree tears the whole tree
        /// down and rebuilds it from scratch on every real data change (or
        /// the #845 blocked-status enrichment pass, which always repaints at
        /// its own completion), and every node was hardcoded IsExpanded=true
        /// - any manual collapse was gone the instant either of those fired.
        /// Keyed by milestone title / "milestone title + epic bucket title"
        /// (stable across rebuilds since those don't change from data
        /// updates), not by TreeViewItem instance, since the instances
        /// themselves are thrown away and recreated every render.
        /// </summary>
        private readonly HashSet<string> _collapsedNodeKeys = new();

        // Git #938 (Epic #803) — the same explicit-MaxWidth truncation fix #932
        // landed on the Chats tree (see ApplyChatTitleMaxWidths), applied here to
        // the Git Board (IssuesTree). CreateMilestoneHeader/CreateEpicHeader/
        // CreateIssueHeader each stack a title TextBlock inside a horizontal
        // StackPanel with no width bound, so a long title measured with the
        // panel's effectively-infinite available width overflowed to the right
        // (Shane: "it scrolls WAY far to the right") instead of trimming. As in
        // #932 — and NOT the Stretch-based approach that failed on this app in
        // #885/#924 — each title TextBlock gets CharacterEllipsis plus an explicit
        // numeric MaxWidth = IssuesTree.ActualWidth − a per-row reserve, recomputed
        // on every width change. The Git Board nests one level deeper than the flat
        // Chats tree (milestone > epic > issue), so the reserves grow ~19px per
        // indentation level; the issue row additionally reserves for its priority +
        // number badges and — only when actually present — the variable-width
        // blocked badge. Over-reserving only trims a few px early (safe);
        // under-reserving re-introduces the overflow, so the reserves lean
        // conservative.
        private const double IssueTreeIndentPerLevel = 19;
        private const double IssueTreeChrome = 6;          // tree left padding/border + safety buffer
        private const double MilestoneEmojiWidth = 22;     // "🎯 " at FontSize 13
        private const double MilestoneBadgeWidth = 56;     // "NN% (n/n)" progress pill + its 8px left margin
        private const double EpicCountWidth = 34;          // " (NN)" issue-count suffix
        private const double IssuePriorityBadgeWidth = 22; // priority glyph + trailing space
        private const double IssueNumberBadgeWidth = 48;   // "#NNN" bordered pill + its 6px right margin
        private const double IssueBlockedBadgeWidth = 78;  // "🔴 Blocked" bordered pill + its 6px right margin

        private readonly List<(TextBlock block, double reserve)> _issueTitleBlocks = new();

        // Git #938 — mirrors ApplyChatTitleMaxWidths: MaxWidth = max(MinTitleWidth,
        // IssuesTree.ActualWidth − reserve). IssuesTree.ActualWidth is the viewport
        // width (already excludes the vertical scrollbar when shown), so no extra
        // scrollbar subtraction is needed. Reuses MinTitleWidth from #932.
        private void ApplyIssueTitleMaxWidths()
        {
            var available = IssuesTree.ActualWidth;
            foreach (var (block, reserve) in _issueTitleBlocks)
            {
                block.MaxWidth = Math.Max(MinTitleWidth, available - reserve);
            }
        }

        // Git #938 — the sidebar can be resized/collapsed/pinned, so recompute the
        // Git Board title MaxWidths whenever the tree's width actually changes.
        // Height-only changes (expanding a milestone/epic) are ignored. Wired in
        // LeftSidebar.xaml on IssuesTree.SizeChanged, mirroring ChatsTree.
        private void IssuesTree_SizeChanged(object sender, SizeChangedEventArgs e)
        {
            if (e.WidthChanged) ApplyIssueTitleMaxWidths();
        }

        private void RenderIssuesTree(string filter)
        {
            IssuesTree.Items.Clear();
            _issueTitleBlocks.Clear();

            // Focus Mode — when a milestone is active, the whole Git Board hard-hides
            // every other milestone (genuinely gone, not greyed), and the stat tiles
            // scope to just the focused one. Off-focus this is the full list unchanged.
            var shownMilestones = _milestones
                .Where(m => BuildConsole.Services.FocusModeService.Instance.IsMilestoneInFocus(m.GithubNumber, m.Title))
                .ToList();

            int totalMilestones = shownMilestones.Count;
            int totalEpics = shownMilestones.Sum(m => m.Epics.Count);
            int openIssues = shownMilestones.Sum(m => m.Epics.Sum(e => e.Issues.Count(i => i.Status != "CLOSED")));
            int closedIssues = shownMilestones.Sum(m => m.Epics.Sum(e => e.Issues.Count(i => i.Status == "CLOSED")));

            IssueStatMilestones.Text = $"{totalMilestones} Active";
            IssueStatEpics.Text = $"{totalEpics} Active";
            IssueStatOpen.Text = $"{openIssues} Pending";
            IssueStatClosed.Text = $"{closedIssues} Done";

            foreach (var m in shownMilestones)
            {
                if (filter == "Milestones" || filter == "All" || filter == "Priority")
                {
                    string milestoneKey = $"m:{m.Title}";
                    var milestoneItem = new TreeViewItem
                    {
                        Header = CreateMilestoneHeader(m),
                        IsExpanded = !_collapsedNodeKeys.Contains(milestoneKey),
                        // Git #921 (Epic #803) — tag the milestone node with its
                        // real data object so IssuesTree_SelectedItemChanged can
                        // route a click to its detail tab. Was untagged (a purely
                        // decorative header) before this — the whole "make the
                        // milestone clickable" ask.
                        Tag = m
                    };
                    milestoneItem.Collapsed += (s, e) => { if (ReferenceEquals(e.OriginalSource, milestoneItem)) _collapsedNodeKeys.Add(milestoneKey); };
                    milestoneItem.Expanded += (s, e) => { if (ReferenceEquals(e.OriginalSource, milestoneItem)) _collapsedNodeKeys.Remove(milestoneKey); };

                    foreach (var epic in m.Epics)
                    {
                        string epicKey = $"e:{m.Title}/{epic.Title}";
                        var epicItem = new TreeViewItem
                        {
                            Header = CreateEpicHeader(epic),
                            IsExpanded = !_collapsedNodeKeys.Contains(epicKey)
                        };
                        epicItem.Collapsed += (s, e) => { if (ReferenceEquals(e.OriginalSource, epicItem)) _collapsedNodeKeys.Add(epicKey); };
                        epicItem.Expanded += (s, e) => { if (ReferenceEquals(e.OriginalSource, epicItem)) _collapsedNodeKeys.Remove(epicKey); };

                        foreach (var issue in epic.Issues)
                        {
                            // Git #839 — default views show real OPEN issues only;
                            // CLOSED are reachable solely through the 🟢 Done chip,
                            // gated on the real issue state, never a "complete" label.
                            if (filter != "Done" && issue.Status == "CLOSED") continue;
                            if (filter == "Done" && issue.Status != "CLOSED") continue;
                            if (filter == "Priority" && issue.Priority != "HIGH") continue;

                            epicItem.Items.Add(CreateIssueHeader(issue));
                        }

                        if (epicItem.Items.Count > 0 || filter == "All" || filter == "Epics")
                        {
                            milestoneItem.Items.Add(epicItem);
                        }
                    }

                    if (milestoneItem.Items.Count > 0 || filter == "All" || filter == "Milestones")
                    {
                        IssuesTree.Items.Add(milestoneItem);
                    }
                }
            }

            // Git #938 — every title block for this render is now registered; apply
            // the explicit MaxWidth against the tree's current width so the
            // CharacterEllipsis trimming actually engages.
            ApplyIssueTitleMaxWidths();
        }

        private static readonly Dictionary<string, SolidColorBrush> _fallbackBrushes = new()
        {
            { "CrustBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#11111B")) },
            { "MantleBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#181825")) },
            { "BaseBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1E1E2E")) },
            { "Surface0Brush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#313244")) },
            { "Surface1Brush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#45475A")) },
            { "TextBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#CDD6F4")) },
            { "Subtext0Brush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#BAC2DE")) },
            { "Subtext1Brush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#A6ADC8")) },
            { "BlueBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#89B4FA")) },
            { "MauveBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#CBA6F7")) },
            { "GreenBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#A6E3A1")) },
            { "RedBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")) },
            { "PeachBrush", new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FAB387")) }
        };

        private Brush GetBrush(string key)
        {
            try
            {
                if (TryFindResource(key) is Brush b) return b;
                if (Application.Current != null && Application.Current.TryFindResource(key) is Brush appB) return appB;
            }
            catch { }

            return _fallbackBrushes.TryGetValue(key, out var fallback) ? fallback : Brushes.Gray;
        }

        private UIElement CreateMilestoneHeader(GitMilestone m)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 3, 0, 3) };
            p.Children.Add(new TextBlock { Text = "🎯 ", FontSize = 13 });
            var titleBlock = new TextBlock { Text = m.Title, FontWeight = FontWeights.Bold, FontSize = 12, Foreground = GetBrush("TextBrush"), TextTrimming = TextTrimming.CharacterEllipsis };
            p.Children.Add(titleBlock);

            // Git #875 — only a real GitHub milestone has a real completed/
            // total to show; the synthetic "No Milestone" bucket doesn't, so
            // it gets no badge at all rather than a fabricated "0%".
            if (m.HasRealCounts)
            {
                var badge = new Border
                {
                    Background = GetBrush("Surface0Brush"),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1, 6, 1),
                    Margin = new Thickness(8, 0, 0, 0)
                };
                badge.Child = new TextBlock
                {
                    Text = m.ProgressStr,
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = GetBrush("BlueBrush")
                };
                p.Children.Add(badge);
            }

            // Git #938 — milestone rows sit at depth 0: one expander column of
            // indentation + the 🎯 emoji, plus the progress pill (only when a real
            // milestone has counts). Register the title for the shared MaxWidth pass.
            _issueTitleBlocks.Add((titleBlock,
                IssueTreeIndentPerLevel * 1 + IssueTreeChrome + MilestoneEmojiWidth
                + (m.HasRealCounts ? MilestoneBadgeWidth : 0)));
            return p;
        }

        private UIElement CreateEpicHeader(GitEpic e)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 2) };
            var titleBlock = new TextBlock { Text = e.Title, FontWeight = FontWeights.SemiBold, FontSize = 11, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(e.ColorHex)), TextTrimming = TextTrimming.CharacterEllipsis };
            p.Children.Add(titleBlock);
            p.Children.Add(new TextBlock { Text = $" ({e.Issues.Count})", FontSize = 10, Foreground = GetBrush("Subtext0Brush"), Margin = new Thickness(4, 0, 0, 0) });

            // Git #938 — epic rows sit at depth 1 (nested under a milestone): two
            // expander columns of indentation + the " (N)" issue-count suffix.
            _issueTitleBlocks.Add((titleBlock,
                IssueTreeIndentPerLevel * 2 + IssueTreeChrome + EpicCountWidth));
            return p;
        }

        private TreeViewItem CreateIssueHeader(GitIssue issue)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 1, 0, 1) };

            var prioBlock = new TextBlock { Text = issue.PriorityBadge + " ", FontSize = 11 };

            var numBlock = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0)
            };
            numBlock.Child = new TextBlock { Text = issue.NumberStr, FontSize = 10, FontWeight = FontWeights.Bold, Foreground = GetBrush("PeachBrush") };

            var titleBlock = new TextBlock
            {
                Text = issue.Title,
                FontSize = 11,
                Foreground = issue.Status == "CLOSED" ? GetBrush("Subtext0Brush") : GetBrush("TextBrush"),
                TextDecorations = issue.Status == "CLOSED" ? TextDecorations.Strikethrough : null,
                TextTrimming = TextTrimming.CharacterEllipsis
            };

            p.Children.Add(prioBlock);
            p.Children.Add(numBlock);

            // Git #845 (Git Board Phase 7) — real still-OPEN blocked_by
            // dependency (EnrichBlockedStatusAsync), same red "Blocked" badge
            // styling as the search view's CreateSearchIssueHeader (#F38BA8).
            if (issue.Status != "CLOSED" && issue.IsBlocked)
            {
                var blockedBadge = new Border
                {
                    Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(0, 0, 6, 0),
                    ToolTip = issue.BlockedByNumber.HasValue ? $"Blocked by #{issue.BlockedByNumber}: {issue.BlockedByTitle}" : "Blocked"
                };
                blockedBadge.Child = new TextBlock { Text = "🔴 Blocked", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = Brushes.Black };
                p.Children.Add(blockedBadge);
            }

            p.Children.Add(titleBlock);

            // Git #938 — issue rows sit at depth 2 (issue > epic > milestone), the
            // deepest tree level: three expander columns of indentation + the
            // priority glyph + the "#NNN" number pill, plus the red "Blocked" pill
            // only when this row is actually showing one (same condition as above).
            bool showsBlocked = issue.Status != "CLOSED" && issue.IsBlocked;
            _issueTitleBlocks.Add((titleBlock,
                IssueTreeIndentPerLevel * 3 + IssueTreeChrome + IssuePriorityBadgeWidth + IssueNumberBadgeWidth
                + (showsBlocked ? IssueBlockedBadgeWidth : 0)));

            var tvi = new TreeViewItem
            {
                Header = p,
                Tag = issue
            };

            // Real toggle - Shane: "Feel free to change anything to patch how I
            // actually work." This tree is live GitHub data now, so a purely
            // local status flip (the old demo behavior) would silently revert
            // on the next real refresh, looking like it worked when nothing
            // actually changed. Toggles the real `complete` label via the same
            // endpoint the extension's own Mark-In-Progress button uses. No
            // real "priority" concept exists anywhere in Build Tracker, so
            // that fake menu item is gone rather than left as a no-op.
            var cm = new ContextMenu();
            var miToggle = new MenuItem { Header = issue.Status == "CLOSED" ? "Remove 'complete' label" : "✓ Mark Complete" };
            miToggle.Click += async (s, e) =>
            {
                if (_api == null) return;
                try
                {
                    await _api.ToggleLabelAsync(issue.IssueNumber, "complete", issue.Status != "CLOSED");
                }
                catch { /* best-effort — next refresh will show the real state either way */ }
                PopulateGitTrackerBoard();
            };
            cm.Items.Add(miToggle);

            // Git #841 (Git Board Phase 3) — real GitHub issue state, not the
            // `complete` label. Shane emphasized reopening specifically: this
            // is the way a closed issue that shouldn't have been comes back
            // into view (default board only shows real OPEN issues per #839).
            var miState = new MenuItem { Header = issue.Status == "CLOSED" ? "↩ Reopen Issue" : "✕ Close Issue" };
            miState.Click += async (s, e) =>
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat) return;
                bool closing = issue.Status != "CLOSED";
                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    await client.SetIssueStateAsync(issue.IssueNumber, closing);
                    ActivityLog.Log("git-board.state-change", $"#{issue.IssueNumber} -> {(closing ? "closed" : "reopened")}");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.state-change", $"#{issue.IssueNumber} state change FAILED: {ex.Message}");
                    ToastEngine.Error("Git Board", $"Couldn't {(closing ? "close" : "reopen")} #{issue.IssueNumber}: {ex.Message}");
                    return;
                }
                _lastInProgressSignature = null;
                _boardShowsClosed = false;
                PopulateGitTrackerBoard();
            };
            cm.Items.Add(miState);

            // Git #843 (Git Board Phase 5) — dialog pre-filled with the real
            // current title/body (already carried on GitIssue.RawTitle/Body
            // from #839's ListBoardIssuesAsync, no second fetch needed). Save
            // does the real PATCH /issues/{n} via GitHubApiClient.
            var miEdit = new MenuItem { Header = "✎ Edit..." };
            miEdit.Click += async (s, e) =>
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat) return;

                var dialog = new EditIssueDialog(issue.IssueNumber, issue.RawTitle, issue.Body);
                if (dialog.ShowDialog() != true) return;

                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    await client.UpdateIssueAsync(issue.IssueNumber, dialog.ResultTitle, dialog.ResultBody);
                    ActivityLog.Log("git-board.edit", $"#{issue.IssueNumber} title/body updated");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.edit", $"#{issue.IssueNumber} update FAILED: {ex.Message}");
                    ToastEngine.Error("Edit Issue", $"Couldn't save #{issue.IssueNumber}: {ex.Message}");
                    return;
                }
                _lastInProgressSignature = null;
                PopulateGitTrackerBoard();
            };
            cm.Items.Add(miEdit);

            // Git #844 (Git Board Phase 6) — picker over the real open issues
            // that ARE epics (already in memory from #839's ListBoardIssuesAsync,
            // no second fetch), links via the same real
            // POST /issues/{parent}/sub_issues endpoint exception-github-sync.ts
            // already uses to attach a filed issue under Epic #530.
            var miAssignEpic = new MenuItem { Header = "🔗 Assign to Epic..." };
            miAssignEpic.Click += async (s, e) =>
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat) return;

                var epicCandidates = _lastBoardIssues
                    .Where(i => i.IsEpic && i.Number != issue.IssueNumber)
                    .OrderByDescending(i => i.Number)
                    .ToList();

                var dialog = new AssignIssueEpicDialog(issue.RawTitle, epicCandidates);
                if (dialog.ShowDialog() != true || dialog.SelectedEpic == null) return;
                var targetEpic = dialog.SelectedEpic;

                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    await client.AddSubIssueAsync(targetEpic.Number, issue.DatabaseId);
                    ActivityLog.Log("git-board.assign-epic", $"#{issue.IssueNumber} assigned under epic #{targetEpic.Number}");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.assign-epic", $"#{issue.IssueNumber} -> #{targetEpic.Number} FAILED: {ex.Message}");
                    ToastEngine.Error("Assign to Epic", $"Couldn't assign #{issue.IssueNumber} to epic #{targetEpic.Number}: {ex.Message}");
                    return;
                }
                _lastInProgressSignature = null;
                PopulateGitTrackerBoard();
            };
            cm.Items.Add(miAssignEpic);

            // Git #845 (Git Board Phase 7) — same picker pattern as #844's
            // "Assign to Epic..." (real open issues already in memory from
            // _lastBoardIssues, no second fetch), sets a real GitHub
            // issue-dependency link via the same POST
            // /issues/{n}/dependencies/blocked_by endpoint CLAUDE.md's
            // blocked-label workflow already uses.
            var miSetBlockedBy = new MenuItem { Header = issue.IsBlocked ? "🚫 Change Blocked By..." : "🚫 Set Blocked By..." };
            miSetBlockedBy.Click += async (s, e) =>
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat) return;

                var blockerCandidates = _lastBoardIssues
                    .Where(i => i.Number != issue.IssueNumber)
                    .OrderByDescending(i => i.Number)
                    .ToList();

                var dialog = new SetBlockedByDialog(issue.RawTitle, blockerCandidates);
                if (dialog.ShowDialog() != true || dialog.SelectedBlocker == null) return;
                var blocker = dialog.SelectedBlocker;

                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    await client.SetBlockedByAsync(issue.IssueNumber, blocker.Number);
                    ActivityLog.Log("git-board.set-blocked-by", $"#{issue.IssueNumber} set blocked by #{blocker.Number}");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.set-blocked-by", $"#{issue.IssueNumber} -> #{blocker.Number} FAILED: {ex.Message}");
                    ToastEngine.Error("Set Blocked By", $"Couldn't set #{issue.IssueNumber} blocked by #{blocker.Number}: {ex.Message}");
                    return;
                }
                _lastInProgressSignature = null;
                PopulateGitTrackerBoard();
            };
            cm.Items.Add(miSetBlockedBy);

            // Git #922 (Epic #803) — Shane: "Right clicking on an epic that
            // does NOT have a chat associated should allow me to create a new
            // chat and associate it to that Epic. Right clicking on an Epic
            // with a chat should allow me to open that Epic's chat." This
            // replicates the browser extension's openNewEpicChat /
            // tryInsertPrefillFromUrl (content.js) into BuildConsole's own
            // WebView2 tabs — the extension isn't installed there. Only epics
            // get this menu item; a plain issue's chat is already reached by the
            // existing In-Flight-click / ChatsTree paths (FindChatForIssue).
            if (issue.IsEpic)
            {
                var linkedChat = FindChatForIssue(issue.IssueNumber);
                if (linkedChat != null && !string.IsNullOrEmpty(linkedChat.ClaudeUrl))
                {
                    // Task 1 — open the epic's existing linked chat via the same
                    // OpenWebTab every other web tab already uses. No prefill.
                    var chatUrl = linkedChat.ClaudeUrl;
                    var miOpenChat = new MenuItem { Header = "💬 Open Epic Chat" };
                    miOpenChat.Click += (s, e) =>
                    {
                        ActivityLog.Log("git-board.epic-chat", $"open linked chat for epic #{issue.IssueNumber} -> {chatUrl}");
                        // Already associated (FindChatForIssue found a linked chat) — no epic number to pass.
                        EpicChatRequested?.Invoke(this, (chatUrl, $"Epic #{issue.IssueNumber} Chat", false, null));
                    };
                    cm.Items.Add(miOpenChat);
                }
                else
                {
                    // Task 2 — no linked chat yet: open the configured
                    // "New chat project URL" prefilled with, in Shane's explicit
                    // order, the GitHub PAT first and THEN "Epic #N" (the reverse
                    // of the extension's own openNewEpicChat label-then-token —
                    // kept as Shane specified). Shane presses Enter himself; we do
                    // NOT auto-rename or auto-associate beyond the message text.
                    var miNewChat = new MenuItem { Header = "➕ New Epic Chat" };
                    miNewChat.Click += (s, e) =>
                    {
                        var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                        if (!settings.HasEpicChatProjectUrl)
                        {
                            ActivityLog.Log("git-board.epic-chat", $"new chat for epic #{issue.IssueNumber} aborted — no New Chat Project URL configured");
                            ToastEngine.Warning("New Epic Chat", "Set a \"New Chat Project URL\" in the Settings tab first.");
                            return;
                        }
                        var baseUrl = settings.EpicChatProjectUrl.Trim();
                        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out _))
                        {
                            ActivityLog.Log("git-board.epic-chat", $"new chat for epic #{issue.IssueNumber} aborted — invalid New Chat Project URL '{baseUrl}'");
                            ToastEngine.Warning("New Epic Chat", "The configured New Chat Project URL isn't a valid URL.");
                            return;
                        }
                        var pat = settings.GitHubPat?.Trim() ?? "";
                        var label = $"Epic #{issue.IssueNumber}";
                        var prefill = string.IsNullOrEmpty(pat) ? label : $"{pat}\r\n{label}";
                        var sep = baseUrl.Contains('?') ? "&" : "?";
                        var fullUrl = $"{baseUrl}{sep}{EpicChatPrefillParam}={Uri.EscapeDataString(prefill)}";
                        ActivityLog.Log("git-board.epic-chat", $"new chat for epic #{issue.IssueNumber} -> {baseUrl} (prefill 'Epic #{issue.IssueNumber}', PAT {(string.IsNullOrEmpty(pat) ? "absent" : "present")})");
                        // Git #922 follow-up — carry the epic's GitHub number so MainWindow links
                        // the new chat to this epic once Shane sends the prefilled message.
                        EpicChatRequested?.Invoke(this, (fullUrl, $"Epic #{issue.IssueNumber} New Chat", true, issue.IssueNumber));
                    };
                    cm.Items.Add(miNewChat);
                }

                // Shane: real chats he can't currently associate to Epics through
                // any manual path. Opens AssignChatToEpicDialog (paste a URL, or
                // "Assign current chat" pulls it off whatever chat tab is
                // actually focused via GetActiveChatUrl). Reuses the same
                // POST /chats/ingest force:true write (LinkChatToEpicAsync) every
                // other chat-epic assignment already goes through, so the Chats
                // panel and every other epic-aware view pick it up immediately —
                // no separate sync step.
                var miAssignChat = new MenuItem { Header = "🔗 Assign Chat to Epic..." };
                miAssignChat.Click += async (s, e) =>
                {
                    if (_api == null || !_api.IsConfigured)
                    {
                        ToastEngine.Warning("Assign Chat to Epic", "Build Tracker API isn't configured.");
                        return;
                    }

                    var existingChat = FindChatForIssue(issue.IssueNumber);
                    var dialog = new AssignChatToEpicDialog($"Epic #{issue.IssueNumber}", existingChat?.ClaudeUrl, GetActiveChatUrl);
                    if (dialog.ShowDialog() != true || string.IsNullOrWhiteSpace(dialog.ResultChatUrl)) return;
                    var chatUrl = dialog.ResultChatUrl.Trim();

                    var convMatch = System.Text.RegularExpressions.Regex.Match(
                        chatUrl, @"/chat/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})");
                    if (!convMatch.Success)
                    {
                        ActivityLog.Log("git-board.assign-chat", $"assign chat to epic #{issue.IssueNumber} aborted — '{chatUrl}' has no recognizable /chat/<uuid> conversation id");
                        ToastEngine.Warning("Assign Chat to Epic", "That doesn't look like a chat URL (expected .../chat/<uuid>).");
                        return;
                    }
                    var conversationId = convMatch.Groups[1].Value;

                    var epic = _chatEpicById.Values.FirstOrDefault(ep => ep.GithubNumber == issue.IssueNumber);
                    if (epic == null)
                    {
                        ActivityLog.Log("git-board.assign-chat", $"assign chat {conversationId} to epic #{issue.IssueNumber} aborted — no bt_epics row has github_number {issue.IssueNumber}");
                        ToastEngine.Warning("Assign Chat to Epic", $"Epic #{issue.IssueNumber} isn't registered in the Build Tracker yet.");
                        return;
                    }

                    try
                    {
                        var res = await _api.LinkChatToEpicAsync(conversationId, epic.Id);
                        if (!res.IsSuccessStatusCode)
                        {
                            var body = await res.Content.ReadAsStringAsync();
                            ActivityLog.Log("git-board.assign-chat", $"assign chat {conversationId} -> epic #{issue.IssueNumber} (bt_epics id {epic.Id}) FAILED: HTTP {(int)res.StatusCode} {body}");
                            ToastEngine.Error("Assign Chat to Epic", $"Couldn't assign: {body}");
                            return;
                        }
                        ActivityLog.Log("git-board.assign-chat", $"assigned chat {conversationId} ({chatUrl}) -> epic #{issue.IssueNumber} (bt_epics id {epic.Id})");
                        _lastBoardSignature = null;
                        PopulateChatsTree();
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log("git-board.assign-chat", $"assign chat {conversationId} -> epic #{issue.IssueNumber} FAILED: {ex.Message}");
                        ToastEngine.Error("Assign Chat to Epic", $"Couldn't assign: {ex.Message}");
                    }
                };
                cm.Items.Add(miAssignChat);
            }

            // Same real capability as the extension's Shane To-Do 🗄 button —
            // only shown when the real GitHub issue body actually references
            // a lib/db/migrations/manual/*.sql file.
            if (!string.IsNullOrEmpty(issue.SqlPath))
            {
                var miLoadSql = new MenuItem { Header = $"🗄 Load {issue.SqlPath} into SQL Runner" };
                miLoadSql.Click += (s, e) => SqlLoadRequested?.Invoke(this, issue.SqlPath!);
                cm.Items.Add(miLoadSql);
            }

            tvi.ContextMenu = cm;
            return tvi;
        }

        // ── GIT BOARD: real GitHub issue search (Git #834) ──────────────────
        // Shane: "I should be able to put in the Git number or title and it
        // searches everything in Git... clearly finds even the closed ones."
        // Replaces the old QuickAddIssueBox_KeyDown fake-add behavior
        // entirely (local-only GitIssue with a placeholder number, never
        // touched GitHub, nothing persisted) — this calls GitHub's real
        // Search Issues API directly (Shane confirmed: direct call, not an
        // api-server proxy) so CLOSED issues show up too, not just whatever
        // GET /extension/in-progress currently has queued.
        private System.Threading.CancellationTokenSource? _issueSearchCts;

        private async void QuickAddIssueBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key != Key.Enter) return;

            string query = QuickAddIssueBox.Text.Trim();
            if (string.IsNullOrEmpty(query)) return;

            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                IssuesTree.Items.Clear();
                IssuesTree.Items.Add(new TreeViewItem { Header = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings)." });
                ActivityLog.Log("git-board.search", "blocked: no GitHub PAT configured");
                return;
            }

            _issueSearchCts?.Cancel();
            var cts = new System.Threading.CancellationTokenSource();
            _issueSearchCts = cts;

            IssuesTree.Items.Clear();
            IssuesTree.Items.Add(new TreeViewItem { Header = $"Searching GitHub for \"{query}\"…" });

            var client = new GitHubApiClient(settings.GitHubPat);
            try
            {
                var results = await client.SearchIssuesAsync(query);
                if (cts.IsCancellationRequested) return;

                ActivityLog.Log("git-board.search", $"query=\"{query}\" -> {results.Count} result(s)");

                IssuesTree.Items.Clear();
                if (results.Count == 0)
                {
                    IssuesTree.Items.Add(new TreeViewItem { Header = "No matching issues found." });
                    return;
                }

                foreach (var result in results)
                {
                    bool blocked = false;
                    if (!result.IsClosed)
                    {
                        try { blocked = await client.HasOpenBlockedByAsync(result.Number); }
                        catch { /* best-effort — worst case this one issue just doesn't show a Blocked badge */ }
                    }
                    if (cts.IsCancellationRequested) return;

                    IssuesTree.Items.Add(CreateSearchIssueHeader(result, blocked));
                }
            }
            catch (Exception ex)
            {
                if (cts.IsCancellationRequested) return;
                IssuesTree.Items.Clear();
                IssuesTree.Items.Add(new TreeViewItem { Header = $"GitHub search failed: {ex.Message}" });
                ActivityLog.Log("git-board.search", $"FAILED query=\"{query}\": {ex.Message}");
            }
        }

        /// <summary>Shane: clearing the search box goes back to the normal live Git Board view, unchanged.</summary>
        private void QuickAddIssueBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(QuickAddIssueBox.Text))
            {
                _issueSearchCts?.Cancel();
                _currentFilter = "All";
                // Git #839 — if the board was showing the CLOSED Done snapshot,
                // reload the real OPEN set rather than filtering it to empty.
                if (_boardShowsClosed)
                {
                    _lastInProgressSignature = null;
                    PopulateGitTrackerBoard();
                }
                else
                {
                    RenderIssuesTree("All");
                }
            }
        }

        private TreeViewItem CreateSearchIssueHeader(GitHubIssueResult result, bool blocked)
        {
            string statusLabel;
            string statusHex;
            if (result.IsClosed) { statusLabel = "Closed"; statusHex = "#A6E3A1"; }
            else if (result.HasInFlightLabel) { statusLabel = "In Flight"; statusHex = "#FAB387"; }
            else if (blocked) { statusLabel = "Blocked"; statusHex = "#F38BA8"; }
            else { statusLabel = "Open"; statusHex = "#89B4FA"; }

            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 1, 0, 1) };

            var numBlock = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0)
            };
            numBlock.Child = new TextBlock { Text = $"#{result.Number}", FontSize = 10, FontWeight = FontWeights.Bold, Foreground = GetBrush("PeachBrush") };

            var statusBadge = new Border
            {
                Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(statusHex)),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0)
            };
            statusBadge.Child = new TextBlock { Text = statusLabel, FontSize = 9, FontWeight = FontWeights.Bold, Foreground = Brushes.Black };

            var titleBlock = new TextBlock
            {
                Text = result.Title,
                FontSize = 11,
                Foreground = result.IsClosed ? GetBrush("Subtext0Brush") : GetBrush("TextBrush"),
                TextDecorations = result.IsClosed ? TextDecorations.Strikethrough : null
            };

            p.Children.Add(numBlock);
            p.Children.Add(statusBadge);
            p.Children.Add(titleBlock);

            var tvi = new TreeViewItem { Header = p, Tag = result };

            var cm = new ContextMenu();
            var miOpen = new MenuItem { Header = "Open on GitHub" };
            miOpen.Click += (s, e) =>
            {
                try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(result.HtmlUrl) { UseShellExecute = true }); }
                catch { }
            };
            cm.Items.Add(miOpen);
            tvi.ContextMenu = cm;

            return tvi;
        }

        private async void IssueFilter_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not Button btn || btn.Tag is not string filter) return;
            _currentFilter = filter;

            if (filter == "Done")
            {
                // Git #839 — the 🟢 Done chip pulls the real CLOSED set on
                // demand, since closed issues are dropped from the default view.
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat)
                {
                    IssuesTree.Items.Clear();
                    IssuesTree.Items.Add(new TreeViewItem { Header = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings)." });
                    return;
                }

                IssuesTree.Items.Clear();
                IssuesTree.Items.Add(new TreeViewItem { Header = "Loading closed issues…" });
                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    var closed = await client.ListBoardIssuesAsync(GitHubIssueState.Closed);
                    var milestoneInfos = await client.GetMilestonesAsync();
                    ActivityLog.Log("git-board.data", $"loaded {closed.Count} closed issue(s) for the Done view");
                    BuildBoardFromGitHub(closed, milestoneInfos);
                    _boardShowsClosed = true;
                    _lastInProgressSignature = null; // force the next poll to repaint the OPEN board
                    RenderIssuesTree("Done");
                }
                catch (Exception ex)
                {
                    IssuesTree.Items.Clear();
                    IssuesTree.Items.Add(new TreeViewItem { Header = $"Couldn't load closed issues: {ex.Message}" });
                    ActivityLog.Log("git-board.data", $"closed-issue fetch FAILED: {ex.Message}");
                }
                return;
            }

            // Leaving the Done snapshot for any other chip: reload the real OPEN
            // board so we're not filtering an empty CLOSED-only set.
            if (_boardShowsClosed)
            {
                PopulateGitTrackerBoard();
                return;
            }

            RenderIssuesTree(filter);
        }

        // ── SEARCH VIEW (Full-Text File Content Search) ──────────────────────
        private void SearchInputBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                PerformFullTextSearch();
            }
        }

        private void BtnExecuteSearch_Click(object sender, RoutedEventArgs e)
        {
            PerformFullTextSearch();
        }

        private void BtnClearSearch_Click(object sender, RoutedEventArgs e)
        {
            SearchInputBox.Text = string.Empty;
            SearchIncludesBox.Text = string.Empty;
            SearchResultsTree.ItemsSource = null;
            SearchSummaryText.Text = "Enter search query & press Enter";
        }

        private async void PerformFullTextSearch()
        {
            string query = SearchInputBox.Text.Trim();
            if (string.IsNullOrEmpty(query))
            {
                SearchResultsTree.ItemsSource = null;
                SearchSummaryText.Text = "Please enter a search query";
                return;
            }

            SearchSummaryText.Text = "Searching file contents...";
            bool matchCase = BtnMatchCase.IsChecked == true;
            string filterPattern = SearchIncludesBox.Text.Trim();

            var results = await System.Threading.Tasks.Task.Run(() =>
            {
                var fileResults = new List<SearchFileResult>();
                try
                {
                    var opt = new EnumerationOptions
                    {
                        IgnoreInaccessible = true,
                        RecurseSubdirectories = true,
                        MaxRecursionDepth = 6
                    };

                    string searchDir = RootWorkspacePath;
                    if (!Directory.Exists(searchDir)) return fileResults;

                    StringComparison comparison = matchCase ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;

                    foreach (var file in Directory.EnumerateFiles(searchDir, "*.*", opt))
                    {
                        string name = Path.GetFileName(file);
                        if (name.StartsWith(".") || file.Contains("\\bin\\") || file.Contains("\\obj\\") || file.Contains("\\node_modules\\") || file.Contains("\\.git\\"))
                            continue;

                        if (!string.IsNullOrEmpty(filterPattern))
                        {
                            string ext = Path.GetExtension(file);
                            if (!filterPattern.Contains(ext, StringComparison.OrdinalIgnoreCase))
                                continue;
                        }

                        try
                        {
                            var lines = File.ReadAllLines(file);
                            var matches = new List<SearchResultLine>();

                            for (int i = 0; i < lines.Length; i++)
                            {
                                if (lines[i].Contains(query, comparison))
                                {
                                    matches.Add(new SearchResultLine
                                    {
                                        FilePath = file,
                                        LineNumber = i + 1,
                                        Snippet = lines[i].Trim()
                                    });

                                    if (matches.Count >= 20) break;
                                }
                            }

                            if (matches.Count > 0)
                            {
                                fileResults.Add(new SearchFileResult
                                {
                                    FilePath = file,
                                    Matches = matches
                                });

                                if (fileResults.Count >= 50) break;
                            }
                        }
                        catch { }
                    }
                }
                catch { }

                return fileResults;
            });

            SearchResultsTree.ItemsSource = results;
            int totalMatches = results.Sum(r => r.Matches.Count);
            SearchSummaryText.Text = $"Found {totalMatches} result{(totalMatches == 1 ? "" : "s")} in {results.Count} file{(results.Count == 1 ? "" : "s")}";
        }

        private void SearchResultsTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is SearchFileResult fileRes)
            {
                FileSelected?.Invoke(this, fileRes.FilePath);
            }
            else if (e.NewValue is SearchResultLine lineRes)
            {
                FileSelected?.Invoke(this, lineRes.FilePath);
            }
        }

        // ── GIT SOURCE CONTROL ENGINE ───────────────────────────────────────

        // Git #859 (Git panel Phase 1, sub-issue of Epic #803) — Shane: "It
        // doesn't stay up to date... It should work like VS Code Source
        // Control panel." Before this, RefreshGitStatus() only ran on
        // view-switch to Git, the manual refresh button, or right after the
        // app's own commit/push/pull, so a commit from anywhere else (a
        // Claude Code session, another tool, a manual `git` command) left the
        // panel stale until Shane happened to click over to it.
        private FileSystemWatcher? _gitWatcher;
        private System.Threading.Timer? _gitWatcherDebounceTimer;
        private static readonly TimeSpan GitWatcherDebounceDelay = TimeSpan.FromMilliseconds(750);

        private void SetupGitWatcher()
        {
            try
            {
                _gitWatcher = new FileSystemWatcher(RootWorkspacePath)
                {
                    IncludeSubdirectories = true,
                    NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size
                };
                _gitWatcher.Changed += OnWorkspaceFileSystemEvent;
                _gitWatcher.Created += OnWorkspaceFileSystemEvent;
                _gitWatcher.Deleted += OnWorkspaceFileSystemEvent;
                _gitWatcher.Renamed += OnWorkspaceFileSystemEvent;
                _gitWatcher.Error += (s, e) => ActivityLog.Log("git-panel.watcher", $"watcher error: {e.GetException().Message}");
                _gitWatcher.EnableRaisingEvents = true;
                ActivityLog.Log("git-panel.watcher", $"watching {RootWorkspacePath} for auto-refresh");
            }
            catch (Exception ex)
            {
                // Best-effort — the manual refresh button and the existing
                // switch-to-Git-view/post-command refreshes still work fine
                // without a live watcher.
                ActivityLog.Log("git-panel.watcher", $"setup FAILED: {ex.Message}");
            }
        }

        /// <summary>
        /// FileSystemWatcher events fire on a background thread, and a single
        /// git operation (a pull, a checkout, a large commit) touches many
        /// files at once, so this both debounces AND marshals onto the UI
        /// thread: each new event restarts a short timer rather than
        /// refreshing immediately, coalescing a burst of N events into
        /// exactly one RefreshGitStatus() call once things go quiet.
        /// </summary>
        private void OnWorkspaceFileSystemEvent(object sender, FileSystemEventArgs e)
        {
            if (IsIgnorableGitInternalPath(e.FullPath)) return;

            _gitWatcherDebounceTimer?.Dispose();
            _gitWatcherDebounceTimer = new System.Threading.Timer(_ =>
            {
                Dispatcher.Invoke(() =>
                {
                    RefreshGitStatus();
                    WorkspaceChanged?.Invoke(this, EventArgs.Empty);
                });
            }, null, GitWatcherDebounceDelay, System.Threading.Timeout.InfiniteTimeSpan);
        }

        /// <summary>
        /// git itself writes constantly under .git/objects (loose objects,
        /// every commit/checkout/pull) and .git/logs (reflogs) as a side
        /// effect of its own operations, not because Shane's working tree
        /// changed — without this filter the watcher would refresh-storm on
        /// git's own internal bookkeeping. Everything else under .git/ (HEAD,
        /// index, refs/) is a real signal worth refreshing on.
        /// </summary>
        private static bool IsIgnorableGitInternalPath(string fullPath)
        {
            string normalized = fullPath.Replace('\\', '/');
            int gitIdx = normalized.IndexOf("/.git/", StringComparison.OrdinalIgnoreCase);
            if (gitIdx < 0) return false;

            string insideGit = normalized.Substring(gitIdx + "/.git/".Length);
            return insideGit.StartsWith("objects/", StringComparison.OrdinalIgnoreCase)
                || insideGit.StartsWith("logs/", StringComparison.OrdinalIgnoreCase)
                || insideGit.EndsWith(".lock", StringComparison.OrdinalIgnoreCase);
        }

        // Git #867 — Shane: "That should update without changing status
        // text.... unless its taking say 30 seconds... then display the
        // loading... text. Otherwise that should just change number no
        // flashing." Previously GitStatusSummaryText was unconditionally
        // set to "REFRESHING GIT STATUS..." on every call, including every
        // #859 debounced FileSystemWatcher auto-refresh (can fire every few
        // seconds during active work), producing a visible flash on every
        // cycle. Now the fetch starts immediately and this delayed timer
        // only shows the loading text if it's still running after 30s; it's
        // disposed the moment the fetch completes, so the fast path goes
        // straight from the old counts to the new ones.
        private System.Threading.Timer? _gitStatusLoadingTimer;

        public async void RefreshGitStatus()
        {
            _gitStatusLoadingTimer?.Dispose();
            _gitStatusLoadingTimer = new System.Threading.Timer(_ =>
            {
                Dispatcher.Invoke(() => GitStatusSummaryText.Text = "REFRESHING GIT STATUS...");
            }, null, TimeSpan.FromSeconds(30), System.Threading.Timeout.InfiniteTimeSpan);

            var (branch, stagedItems, unstagedItems) = await System.Threading.Tasks.Task.Run(() =>
            {
                string b = "main";
                var staged = new List<GitItem>();
                var unstaged = new List<GitItem>();

                try
                {
                    var psi = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "git",
                        Arguments = "status --porcelain -b",
                        WorkingDirectory = RootWorkspacePath,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };

                    using var proc = System.Diagnostics.Process.Start(psi);
                    if (proc != null)
                    {
                        string output = proc.StandardOutput.ReadToEnd();
                        proc.WaitForExit();

                        string[] lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                        foreach (var line in lines)
                        {
                            if (line.StartsWith("##"))
                            {
                                string branchLine = line.Substring(2).Trim();
                                int dots = branchLine.IndexOf("...");
                                b = dots > 0 ? branchLine.Substring(0, dots) : branchLine;
                            }
                            else if (line.Length >= 4)
                            {
                                char indexState = line[0];
                                char workState = line[1];
                                string relPath = line.Substring(3).Trim().Trim('"');
                                string fullPath = System.IO.Path.Combine(RootWorkspacePath, relPath.Replace('/', '\\'));

                                if (indexState != ' ' && indexState != '?')
                                {
                                    staged.Add(new GitItem
                                    {
                                        FilePath = fullPath,
                                        RelativePath = relPath,
                                        StatusLetter = indexState.ToString(),
                                        IsStaged = true
                                    });
                                }

                                if (workState != ' ')
                                {
                                    unstaged.Add(new GitItem
                                    {
                                        FilePath = fullPath,
                                        RelativePath = relPath,
                                        StatusLetter = workState == '?' ? "U" : workState.ToString(),
                                        IsStaged = false
                                    });
                                }
                            }
                        }
                    }
                }
                catch { }

                return (b, staged, unstaged);
            });

            _gitStatusLoadingTimer?.Dispose();
            _gitStatusLoadingTimer = null;

            GitBranchText.Text = branch;
            GitStatusSummaryText.Text = $"STAGED ({stagedItems.Count})  •  CHANGES ({unstagedItems.Count})";

            GitChangesTree.Items.Clear();

            // Staged Tree Header
            var stagedTreeItem = new TreeViewItem
            {
                Header = CreateGitCategoryHeader("STAGED CHANGES", stagedItems.Count, "#A6E3A1"),
                IsExpanded = true
            };
            foreach (var item in stagedItems)
            {
                stagedTreeItem.Items.Add(CreateGitFileTreeItem(item));
            }

            // Unstaged Tree Header
            var unstagedTreeItem = new TreeViewItem
            {
                Header = CreateGitCategoryHeader("CHANGES", unstagedItems.Count, "#FAB387"),
                IsExpanded = true
            };
            foreach (var item in unstagedItems)
            {
                unstagedTreeItem.Items.Add(CreateGitFileTreeItem(item));
            }

            GitChangesTree.Items.Add(stagedTreeItem);
            GitChangesTree.Items.Add(unstagedTreeItem);

            // Git #860 (Git panel Phase 2) — the rendered commit graph lives in
            // the same scrollable panel below Changes; refresh it from the same
            // trigger so both sections stay in sync (view-switch, manual
            // refresh, own commit/push/pull, and #859's FileSystemWatcher).
            PopulateGitGraph();
        }

        private UIElement CreateGitCategoryHeader(string title, int count, string hexColor)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 2) };
            p.Children.Add(new TextBlock { Text = title, FontWeight = FontWeights.Bold, FontSize = 11, Foreground = (Brush)FindResource("TextBrush") });
            p.Children.Add(new TextBlock { Text = $" ({count})", FontSize = 11, FontWeight = FontWeights.Bold, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hexColor)), Margin = new Thickness(4, 0, 0, 0) });
            return p;
        }

        private TreeViewItem CreateGitFileTreeItem(GitItem item)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 1, 0, 1) };
            
            var badge = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0)
            };
            badge.Child = new TextBlock
            {
                Text = item.StatusLetter,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = item.StatusBrush
            };

            var txt = new TextBlock
            {
                Text = item.FileName,
                FontSize = 12,
                Foreground = (Brush)FindResource("TextBrush"),
                ToolTip = item.RelativePath
            };

            p.Children.Add(badge);
            p.Children.Add(txt);

            var tvi = new TreeViewItem
            {
                Header = p,
                Tag = item
            };

            // Context menu for Git actions
            var cm = new ContextMenu();
            if (item.IsStaged)
            {
                var miUnstage = new MenuItem { Header = "Unstage Change (-)" };
                miUnstage.Click += (s, e) => RunGitCommand($"restore --staged \"{item.RelativePath}\"");
                cm.Items.Add(miUnstage);
            }
            else
            {
                var miStage = new MenuItem { Header = "Stage Change (+)" };
                miStage.Click += (s, e) => RunGitCommand($"add \"{item.RelativePath}\"");
                cm.Items.Add(miStage);

                var miDiscard = new MenuItem { Header = "Discard Changes (↩)" };
                miDiscard.Click += (s, e) => RunGitCommand($"checkout -- \"{item.RelativePath}\"");
                cm.Items.Add(miDiscard);
            }

            var miOpen = new MenuItem { Header = "Open File" };
            miOpen.Click += (s, e) => FileSelected?.Invoke(this, item.FilePath);
            cm.Items.Add(miOpen);

            tvi.ContextMenu = cm;
            return tvi;
        }

        private async void RunGitCommand(string args)
        {
            GitStatusSummaryText.Text = $"RUNNING: git {args}...";
            await System.Threading.Tasks.Task.Run(() =>
            {
                try
                {
                    var psi = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "git",
                        Arguments = args,
                        WorkingDirectory = RootWorkspacePath,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };
                    using var p = System.Diagnostics.Process.Start(psi);
                    p?.WaitForExit();
                }
                catch { }
            });

            RefreshGitStatus();
        }

        private void BtnGitRefresh_Click(object sender, RoutedEventArgs e) => RefreshGitStatus();
        private void BtnGitPush_Click(object sender, RoutedEventArgs e) => RunGitCommand("push");
        private void BtnGitPull_Click(object sender, RoutedEventArgs e) => RunGitCommand("pull");

        // ── GIT #860 (Git panel Phase 2): real rendered commit graph ────────
        // Replaces the old PopulateGitHistoryGraph(), which parsed
        // `git log --graph`'s ASCII art line-by-line and SILENTLY DROPPED any
        // connector-only line lacking a '|' (the `if (pipeIdx > 0)` guard),
        // throwing away all branch/merge topology. This builds the REAL commit
        // DAG from each commit's actual parent hashes (`git log --all
        // --pretty=%H|%P|...`), computes lane/column assignment itself (a
        // standard swimlane layout), and renders a Canvas of colored dots +
        // curved/straight connectors, GitLens/SourceTree-style. It refreshes
        // together with the Changes list off #859's FileSystemWatcher (called
        // at the tail of RefreshGitStatus), never on a separate schedule.

        private const int GitGraphMaxCommits = 40;
        private const double GitGraphLaneWidth = 16;
        private const double GitGraphRowHeight = 24;
        private const double GitGraphDotRadius = 4.5;
        private const double GitGraphLeftPad = 11;

        // Lane colors — reuse the app's existing Catppuccin palette (the same
        // hexes GitChangesTree's status badges / _fallbackBrushes use), cycled
        // by column index so each branch lane reads as its own color.
        private static readonly string[] GitGraphLaneColors =
        {
            "#89B4FA", // blue
            "#A6E3A1", // green
            "#FAB387", // peach
            "#CBA6F7", // mauve
            "#F5C2E7", // pink
            "#94E2D5", // teal
            "#F38BA8", // red
            "#F9E2AF", // yellow
        };

        /// <summary>One commit row in the rendered DAG, with its self-computed lane column.</summary>
        private sealed class GitGraphCommit
        {
            public string Hash = "";
            public string ShortHash = "";
            public string[] Parents = Array.Empty<string>();
            public string Message = "";
            public string Author = "";
            public string Date = "";
            public int Row;
            public int Column;                 // lane this commit's dot sits in
            public bool IsMerge => Parents.Length > 1;
        }

        private static SolidColorBrush GitLaneBrush(int column) =>
            new SolidColorBrush((Color)ColorConverter.ConvertFromString(
                GitGraphLaneColors[((column % GitGraphLaneColors.Length) + GitGraphLaneColors.Length) % GitGraphLaneColors.Length]));

        private static double GitLaneX(int column) => GitGraphLeftPad + column * GitGraphLaneWidth;
        private static double GitRowY(int row) => row * GitGraphRowHeight + GitGraphRowHeight / 2;

        /// <summary>
        /// Fetches the real commit DAG and renders it into GitGraphHost. Runs
        /// the (blocking) git call on a worker thread, then builds the WPF
        /// visuals on the UI thread. Called from RefreshGitStatus so the graph
        /// and the Changes list always refresh from the same trigger (#859).
        /// </summary>
        public async void PopulateGitGraph()
        {
            var (commits, maxLanes) = await System.Threading.Tasks.Task.Run(() =>
            {
                var parsed = new List<GitGraphCommit>();
                try
                {
                    var psi = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "git",
                        // %P = full parent hashes (space-separated; merge commits
                        // have 2+). Fields are \x1f-delimited because a commit
                        // subject can itself contain '|', which the old naive
                        // pipe-split mangled.
                        Arguments = $"log --exclude=refs/stash --all --date-order -n {GitGraphMaxCommits} --pretty=format:%H%x1f%P%x1f%s%x1f%an%x1f%cr",
                        WorkingDirectory = RootWorkspacePath,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    };

                    using var proc = System.Diagnostics.Process.Start(psi);
                    if (proc != null)
                    {
                        string output = proc.StandardOutput.ReadToEnd();
                        proc.WaitForExit();

                        foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                        {
                            var parts = line.Split('\u001f');
                            if (parts.Length < 5) continue;
                            string hash = parts[0].Trim();
                            if (hash.Length == 0) continue;
                            parsed.Add(new GitGraphCommit
                            {
                                Hash = hash,
                                ShortHash = hash.Length >= 7 ? hash.Substring(0, 7) : hash,
                                Parents = parts[1].Length == 0
                                    ? Array.Empty<string>()
                                    : parts[1].Split(' ', StringSplitOptions.RemoveEmptyEntries),
                                Message = parts[2],
                                Author = parts[3],
                                Date = parts[4],
                            });
                        }
                    }
                }
                catch { }

                // Swimlane layout. `lanes[c]` = the hash that lane c is currently
                // routing toward (a parent some already-drawn child is waiting on),
                // or null if the lane is free. Newest commit is processed first.
                var lanes = new List<string?>();
                int maxLaneCount = 0;
                for (int i = 0; i < parsed.Count; i++)
                {
                    var c = parsed[i];
                    c.Row = i;

                    // This commit takes the leftmost lane already awaiting it; if
                    // none is (it's a branch tip), it opens a fresh lane.
                    int col = lanes.FindIndex(h => h == c.Hash);
                    if (col < 0)
                    {
                        col = lanes.FindIndex(h => h == null);
                        if (col < 0) { lanes.Add(null); col = lanes.Count - 1; }
                    }
                    c.Column = col;

                    // The first parent continues this lane; extra children that
                    // were also awaiting this commit (merge-in) close their lanes.
                    lanes[col] = c.Parents.Length > 0 ? c.Parents[0] : null;
                    for (int j = 0; j < lanes.Count; j++)
                        if (j != col && lanes[j] == c.Hash) lanes[j] = null;

                    // Each additional parent (a merge's other side) needs a lane —
                    // reuse one already awaiting that parent, else open a new one.
                    for (int pi = 1; pi < c.Parents.Length; pi++)
                    {
                        string p = c.Parents[pi];
                        if (lanes.FindIndex(h => h == p) >= 0) continue;
                        int free = lanes.FindIndex(h => h == null);
                        if (free < 0) lanes.Add(p); else lanes[free] = p;
                    }

                    // Keep width tight — trailing free lanes don't need columns.
                    while (lanes.Count > 0 && lanes[lanes.Count - 1] == null) lanes.RemoveAt(lanes.Count - 1);
                    maxLaneCount = Math.Max(maxLaneCount, Math.Max(lanes.Count, col + 1));
                }

                return (parsed, Math.Max(maxLaneCount, 1));
            });

            GitGraphHost.Children.Clear();
            GitGraphHeaderText.Text = $"COMMIT GRAPH ({commits.Count})";
            ActivityLog.Log("git-panel.graph", $"rendered {commits.Count} commit(s) across {maxLanes} lane(s)");

            if (commits.Count == 0)
            {
                GitGraphHost.Children.Add(new TextBlock
                {
                    Text = "No commit history.",
                    FontSize = 11,
                    Foreground = GetBrush("Subtext0Brush"),
                    Margin = new Thickness(2, 4, 0, 0)
                });
                return;
            }

            var byHash = commits.ToDictionary(c => c.Hash);
            double graphWidth = GitGraphLeftPad + maxLanes * GitGraphLaneWidth;
            double totalHeight = commits.Count * GitGraphRowHeight;

            // Two aligned columns sharing the same per-row height: the rendered
            // lane graph on the left, the commit hash/message text on the right.
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(graphWidth) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var canvas = new Canvas { Width = graphWidth, Height = totalHeight };
            var crust = GetBrush("CrustBrush");
            var mantle = GetBrush("MantleBrush");

            // Draw connectors first (dots sit on top). Each edge runs from a
            // commit down to each of its real parents' positions; a parent
            // outside the fetched window gets a short downward stub instead.
            foreach (var c in commits)
            {
                double cx = GitLaneX(c.Column), cy = GitRowY(c.Row);
                for (int pi = 0; pi < c.Parents.Length; pi++)
                {
                    if (byHash.TryGetValue(c.Parents[pi], out var parent))
                    {
                        double px = GitLaneX(parent.Column), py = GitRowY(parent.Row);
                        var brush = GitLaneBrush(pi == 0 ? c.Column : parent.Column);
                        if (Math.Abs(px - cx) < 0.1)
                        {
                            canvas.Children.Add(new System.Windows.Shapes.Line
                            {
                                X1 = cx, Y1 = cy, X2 = px, Y2 = py,
                                Stroke = brush, StrokeThickness = 2
                            });
                        }
                        else
                        {
                            double midY = (cy + py) / 2;
                            var fig = new PathFigure { StartPoint = new Point(cx, cy) };
                            fig.Segments.Add(new BezierSegment(new Point(cx, midY), new Point(px, midY), new Point(px, py), true));
                            var geo = new PathGeometry();
                            geo.Figures.Add(fig);
                            canvas.Children.Add(new System.Windows.Shapes.Path
                            {
                                Data = geo, Stroke = brush, StrokeThickness = 2
                            });
                        }
                    }
                    else
                    {
                        // Parent beyond the fetched window — stub downward so the
                        // lane visibly continues off the bottom rather than dead-ending.
                        canvas.Children.Add(new System.Windows.Shapes.Line
                        {
                            X1 = cx, Y1 = cy, X2 = cx, Y2 = cy + GitGraphRowHeight / 2,
                            Stroke = GitLaneBrush(c.Column), StrokeThickness = 2
                        });
                    }
                }
            }

            // Commit dots on top of the connectors. Merge commits render as a
            // hollow ring so they're distinguishable at a glance.
            foreach (var c in commits)
            {
                double cx = GitLaneX(c.Column), cy = GitRowY(c.Row);
                var laneBrush = GitLaneBrush(c.Column);
                var dot = new System.Windows.Shapes.Ellipse
                {
                    Width = GitGraphDotRadius * 2,
                    Height = GitGraphDotRadius * 2,
                    Fill = c.IsMerge ? mantle : laneBrush,
                    Stroke = c.IsMerge ? laneBrush : crust,
                    StrokeThickness = c.IsMerge ? 2.5 : 1.5,
                    ToolTip = $"{c.ShortHash}  {c.Message}\n{c.Author} · {c.Date}"
                };
                Canvas.SetLeft(dot, cx - GitGraphDotRadius);
                Canvas.SetTop(dot, cy - GitGraphDotRadius);
                canvas.Children.Add(dot);
            }

            Grid.SetColumn(canvas, 0);
            grid.Children.Add(canvas);

            // Right column: one fixed-height text row per commit, aligned to the
            // canvas rows (same GitGraphRowHeight), so hash/message line up with
            // their dots.
            var textStack = new StackPanel();
            foreach (var c in commits)
            {
                var row = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    Height = GitGraphRowHeight,
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(6, 0, 0, 0)
                };

                var hashBorder = new Border
                {
                    Background = GetBrush("Surface0Brush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(0, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center
                };
                hashBorder.Child = new TextBlock
                {
                    Text = c.ShortHash,
                    FontFamily = new FontFamily("Consolas"),
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = GetBrush("PeachBrush")
                };

                var msgTxt = new TextBlock
                {
                    Text = c.Message,
                    FontSize = 11,
                    Foreground = GetBrush("TextBrush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = $"{c.ShortHash}  {c.Message}\n{c.Author} · {c.Date}"
                };

                row.Children.Add(hashBorder);
                row.Children.Add(msgTxt);
                textStack.Children.Add(row);
            }

            Grid.SetColumn(textStack, 1);
            grid.Children.Add(textStack);

            GitGraphHost.Children.Add(grid);
        }

        private void BtnGitCommit_Click(object sender, RoutedEventArgs e)
        {
            string msg = GitCommitMsgBox.Text.Trim();
            if (string.IsNullOrEmpty(msg))
            {
                GitStatusSummaryText.Text = "Please enter a commit message";
                return;
            }

            RunGitCommand($"commit -m \"{msg.Replace("\"", "\\\"")}\"");
            GitCommitMsgBox.Text = string.Empty;
        }

        private void GitCommitMsgBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Return && (Keyboard.Modifiers & ModifierKeys.Control) == ModifierKeys.Control)
            {
                e.Handled = true;
                BtnGitCommit_Click(sender, e);
            }
        }

        private void GitChangesTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is GitItem item)
            {
                FileSelected?.Invoke(this, item.FilePath);
            }
        }

        public void LoadWorkspaceExplorer(string rootPath)
        {
            ExplorerTree.Items.Clear();
            if (!Directory.Exists(rootPath)) return;

            var rootDir = new DirectoryInfo(rootPath);
            var rootNode = CreateDirectoryNode(rootDir);
            rootNode.IsExpanded = true;
            ExplorerTree.Items.Add(rootNode);
        }

        private TreeViewItem CreateDirectoryNode(DirectoryInfo dir)
        {
            var item = new TreeViewItem
            {
                Tag = dir.FullName,
                Header = CreateHeaderPanel("\uE838", dir.Name, FrozenBrush(0xFA, 0xB3, 0x87), isBold: true),
                ContextMenu = CreateExplorerContextMenu(dir.FullName, isDirectory: true)
            };

            item.Items.Add(new TreeViewItem { Header = "Loading..." });
            item.Expanded += DirectoryNode_Expanded;
            return item;
        }

        private void DirectoryNode_Expanded(object sender, RoutedEventArgs e)
        {
            if (sender is TreeViewItem dirNode && dirNode.Tag is string path)
            {
                if (dirNode.Items.Count == 1 && dirNode.Items[0] is TreeViewItem dummy && dummy.Header?.ToString() == "Loading...")
                {
                    dirNode.Items.Clear();
                    try
                    {
                        var dirInfo = new DirectoryInfo(path);

                        foreach (var subDir in dirInfo.GetDirectories())
                        {
                            // Skip hidden system/cache folders if wanted, but list repo folders
                            if (subDir.Name.Equals(".git", StringComparison.OrdinalIgnoreCase) ||
                                subDir.Name.Equals("node_modules", StringComparison.OrdinalIgnoreCase) ||
                                subDir.Name.Equals("bin", StringComparison.OrdinalIgnoreCase) ||
                                subDir.Name.Equals("obj", StringComparison.OrdinalIgnoreCase))
                            {
                                continue;
                            }

                            dirNode.Items.Add(CreateDirectoryNode(subDir));
                        }

                        foreach (var file in dirInfo.GetFiles())
                        {
                            dirNode.Items.Add(CreateFileNode(file));
                        }
                    }
                    catch (Exception ex)
                    {
                        dirNode.Items.Add(new TreeViewItem { Header = $"Access Denied: {ex.Message}" });
                    }
                }
            }
        }

        private TreeViewItem CreateFileNode(FileInfo file)
        {
            var (icon, color) = GetFileIconAndColor(file.Extension);
            var item = new TreeViewItem
            {
                Tag = file.FullName,
                Header = CreateHeaderPanel(icon, file.Name, color, isBold: false),
                ContextMenu = CreateExplorerContextMenu(file.FullName, isDirectory: false)
            };
            return item;
        }

        private ContextMenu CreateExplorerContextMenu(string path, bool isDirectory)
        {
            var cm = new ContextMenu();

            if (!isDirectory)
            {
                var miOpen = new MenuItem { Header = "Open" };
                miOpen.Click += (s, e) => FileSelected?.Invoke(this, path);
                cm.Items.Add(miOpen);
            }

            var miCopyPath = new MenuItem { Header = "Copy Path" };
            miCopyPath.Click += (s, e) => Clipboard.SetText(path);
            cm.Items.Add(miCopyPath);

            var miReveal = new MenuItem { Header = "Reveal in File Explorer" };
            miReveal.Click += (s, e) =>
            {
                try
                {
                    System.Diagnostics.Process.Start("explorer.exe", isDirectory ? $"\"{path}\"" : $"/select,\"{path}\"");
                }
                catch { }
            };
            cm.Items.Add(miReveal);

            cm.Items.Add(new Separator());

            var miRefresh = new MenuItem { Header = "Refresh Explorer" };
            miRefresh.Click += (s, e) => LoadWorkspaceExplorer(RootWorkspacePath);
            cm.Items.Add(miRefresh);

            return cm;
        }

        private StackPanel CreateHeaderPanel(string iconText, string text, Brush foreground, bool isBold)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal };
            var iconBlock = new TextBlock
            {
                Text = iconText,
                FontSize = 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            };
            if (iconText.Length == 1 && iconText[0] >= 0xE000)
            {
                iconBlock.FontFamily = new FontFamily("Segoe MDL2 Assets");
                iconBlock.Foreground = foreground;
            }

            var textBlock = new TextBlock
            {
                Text = text,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = isBold ? (Brush)FindResource("TextBrush") : foreground
            };
            if (isBold) textBlock.FontWeight = FontWeights.SemiBold;

            sp.Children.Add(iconBlock);
            sp.Children.Add(textBlock);
            return sp;
        }

        private (string icon, Brush color) GetFileIconAndColor(string ext)
        {
            switch (ext.ToLowerInvariant())
            {
                case ".cs":
                    return ("⚡", FrozenBrush(0x89, 0xB4, 0xFA)); // Blue
                case ".xaml":
                    return ("🎨", FrozenBrush(0xCB, 0xA6, 0xF7)); // Mauve
                case ".ts":
                case ".tsx":
                case ".js":
                case ".jsx":
                    return ("⚛", FrozenBrush(0x89, 0xDC, 0xEB)); // Cyan
                case ".json":
                case ".config":
                case ".yaml":
                case ".yml":
                    return ("⚙", FrozenBrush(0xA6, 0xE3, 0xA1)); // Green
                case ".csproj":
                case ".sln":
                    return ("📦", FrozenBrush(0xF3, 0x8B, 0xA8)); // Red
                case ".md":
                case ".txt":
                case ".log":
                    return ("📝", FrozenBrush(0x94, 0xE2, 0xD5)); // Teal
                case ".gitignore":
                    return ("🔀", FrozenBrush(0xFA, 0xB3, 0x87)); // Orange
                default:
                    return ("📄", FrozenBrush(0xCD, 0xD6, 0xF4)); // Text
            }
        }

        private static SolidColorBrush FrozenBrush(byte r, byte g, byte b)
        {
            var b2 = new SolidColorBrush(Color.FromRgb(r, g, b));
            b2.Freeze();
            return b2;
        }

        private void CollapseAll_Click(object sender, RoutedEventArgs e)
        {
            // Collapse all top-level nodes in the active tree
            var tree = _currentView == "Explorer" ? ExplorerTree : ChatsTree;
            foreach (var item in tree.Items)
            {
                if (tree.ItemContainerGenerator.ContainerFromItem(item) is TreeViewItem tvi)
                    tvi.IsExpanded = false;
            }
        }
    }
}

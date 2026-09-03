using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using Ellipse = System.Windows.Shapes.Ellipse;
using System.Windows.Threading;
using BuildConsole.Services;
using System.Text.Json;

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
        public string State { get; set; } = "open";
        public bool IsClosed => string.Equals(State, "closed", StringComparison.OrdinalIgnoreCase);
        public int ProgressPercent => TotalCount == 0 ? 0 : (CompletedCount * 100 / TotalCount);
        public string ProgressStr => $"{ProgressPercent}% ({CompletedCount}/{TotalCount})";
        public List<GitEpic> Epics { get; set; } = new();
        /// <summary>Shane, 2026-08-28: "If a parent has children in flight or working, there should be an indicator all the way down the chain." True when any issue nested anywhere under this milestone is in-flight, so a collapsed milestone still tells you something's moving underneath it. Computed fresh in RenderIssuesTree from the live per-issue flags.</summary>
        public bool HasInFlightDescendant { get; set; }
    }

    public class GitEpic
    {
        public string Title { get; set; } = string.Empty;
        public string ColorHex { get; set; } = "#CBA6F7";
        public List<GitIssue> Issues { get; set; } = new();
        /// <summary>Shane, 2026-08-28 — same "indicator all the way down the chain" as <see cref="GitMilestone.HasInFlightDescendant"/>, scoped to this bucket (e.g. the "⚡ Epics" bucket) instead of the whole milestone.</summary>
        public bool HasInFlightDescendant { get; set; }
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
        /// <summary>Git #1368 — real "in-flight" label straight off the board's own GraphQL labels fetch (see <see cref="GitBoardIssue.HasInFlightLabel"/>), no separate REST call needed unlike <see cref="IsBlocked"/>.</summary>
        public bool IsInFlight { get; set; }
        /// <summary>Git #1930 — the issue's real, current GitHub labels, carried through from whichever source (<see cref="GitBoardIssue.Labels"/>, <see cref="GitHubIssueResult.Labels"/>, <see cref="GitHubIssueDetail.Labels"/>) constructed this <see cref="GitIssue"/>, so the detail tab can render them without a second fetch.</summary>
        public List<GitHubLabel> Labels { get; set; } = new();
        /// <summary>Shane, 2026-08-28: "If a parent has children in flight or working, there should be an indicator all the way down the chain... I have to expand everything to try and find it." True when this issue is NOT itself in-flight but has some descendant (sub-issue, sub-sub-issue, etc., however deep) that is — so every ancestor on the path down to the real in-flight item shows something without expanding the tree. Computed fresh in RenderIssuesTree from the live IsInFlight flags via the same ParentNumber chain PopulateIssueTreeHierarchy nests on.</summary>
        public bool HasInFlightDescendant { get; set; }
        public bool HasParentEpic { get; set; }
        public int? ParentNumber { get; set; }
        public int SubIssueCount { get; set; }
        public bool IsComplete { get; set; }
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
        /// <summary>The manifest uiStep's optional `"critical": true` flag (see ManifestUiStep.Critical): when a
        /// critical step fails, UiTestExecutor halts the whole run immediately rather than proceeding to the
        /// remaining steps. False for manually-recorded steps and steps that keep the default WARN-and-continue.</summary>
        public bool Critical { get; set; }
    }

    public class GraphApiSelectionArgs : EventArgs
    {
        public GraphApiEndpointType Type { get; set; }
        public string Key { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string Endpoint { get; set; } = string.Empty;
        public string Method { get; set; } = string.Empty;
        public List<string> RequiredVariables { get; set; } = new();
        public string? BodyTemplate { get; set; }
    }

    public class GraphApiTreeItemData
    {
        public GraphApiEndpointType Type { get; set; }
        public string Key { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string Endpoint { get; set; } = string.Empty;
        public string Method { get; set; } = string.Empty;
        public List<string> RequiredVariables { get; set; } = new();
        public string? BodyTemplate { get; set; }
    }

    public partial class LeftSidebar : UserControl
    {
        public event EventHandler<GraphApiSelectionArgs>? GraphApiSelected;

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
        public event EventHandler<(string Url, string Title, bool InjectPrefill, int? IssueNumber, string IssueType, string DefaultTitle)>? EpicChatRequested;

        /// <summary>Git #840 (Git Board Phase 2) — fired when Shane clicks an issue node in the Git Board tree, so MainWindow can show its real description/comment thread.</summary>
        public event EventHandler<GitIssue>? IssueSelected;
        /// <summary>Git #921 (Epic #803) — fired when Shane clicks a milestone header in the Git Board tree, so MainWindow opens (or focuses) its native ADHD-friendly milestone detail tab. Additive to the tree; milestones have no side-panel behaviour of their own.</summary>
        public event EventHandler<GitMilestone>? MilestoneTabRequested;
        /// <summary>Git #921 (Epic #803) — fired alongside <see cref="IssueSelected"/> when Shane clicks an issue/epic node, so MainWindow opens (or focuses) its native detail tab (epic vs issue routed by <see cref="GitIssue.IsEpic"/>). Deliberately additive: <see cref="IssueSelected"/> still drives the quick-glance side panel.</summary>
        public event EventHandler<GitIssue>? GitDetailTabRequested;
        /// <summary>Fired when Shane clicks "Load SQL" on a Shane To-Do item — MainWindow fetches the real text and hands it to SqlRunnerView.</summary>
        public event EventHandler<string>? SqlLoadRequested;
        /// <summary>
        /// Fired right after "Assign Chat to Epic..." successfully links a chat
        /// (conversationId) to an epic (bt_epics id). An already-open chat tab's
        /// TabItem.Tag holds a BoardChat SNAPSHOT taken when the tab was opened
        /// — assigning an epic afterward never touches that snapshot, and the
        /// Build Queue panel's "Issues in Epic" section only re-reads it on
        /// EditorTabs.SelectionChanged (MainWindow.EditorTabs_SelectionChanged),
        /// so without this the section stayed stuck on stale/no-epic state
        /// until the app was restarted and every tab got rebuilt from a fresh
        /// board fetch. MainWindow updates the matching open tab's Tag and, if
        /// it's the active tab, re-feeds BuildQueuePanel immediately.
        /// </summary>
#pragma warning disable CS0067 // never raised yet — tracked as Git #1706
        public event EventHandler<(string ConversationId, int EpicId)>? ChatEpicAssigned;
#pragma warning restore CS0067
        /// <summary>Shane, 2026-08-28: "when a build is in Verifying state and then the Git issue behind it is closed, it should change to closed and hide." Fired after PopulateGitTrackerBoard's fresh open-issue fetch promotes one or more Verifying queue rows to Done (their real GitHub issue closed) — MainWindow re-fetches the Build Queue panel so the promoted item disappears from the Active view immediately instead of waiting for its own next poll.</summary>
        public event EventHandler? VerifyingIssuesPromoted;
        /// <summary>Git #1600 — fired at the end of every successful PopulateGitTrackerBoard
        /// fetch (not just when something got promoted). MainWindow uses this to kick an
        /// immediate QueueWatcherService re-check so a queue item HELD on a GitHub blocker
        /// releases right when Shane refreshes the board, instead of waiting up to 10s for
        /// the watcher's own next timer tick.</summary>
        public event EventHandler? BoardRefreshCompleted;
        /// <summary>
        /// Git #1632 — fired at the end of every successful PopulateGitTrackerBoard
        /// fetch with the real open-issue-number set it just fetched (same shape
        /// CheckIssueClosuresAsync/ComputeOpenGithubNumbersOrNull already use).
        /// MainWindow forwards this into an open BuildWatchWindow (if one exists) so
        /// it can evict closed-issue slots and promote Verifying→Done off data that
        /// was already fetched for another reason — zero incremental `gh` calls, no
        /// new polling. This is the "free" half of #1632's two triggers; the other
        /// half is BuildWatchWindow's own manual "Recheck closures" title-bar icon.
        /// </summary>
        public event EventHandler<HashSet<int>>? GitBoardOpenIssuesRefreshed;
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
        public Func<IReadOnlyList<QueueItem>>? GetQueueItems { get; set; }

        /// <summary>Git #2061 — set by MainWindow to the matching BuildQueuePanel.Quick*Async
        /// wrapper, so the Git Board issue-hover popover's single primary action button can
        /// trigger the exact same effect as the equivalent right-click menu item (#2030's
        /// inventory) without LeftSidebar needing a direct reference to BuildQueuePanel or its
        /// private _watcher/_db fields. Same delegate-property pattern as GetQueueItems above.</summary>
        public Func<QueueItem, System.Threading.Tasks.Task>? RequestDispatchBuild { get; set; }
        public Func<QueueItem, System.Threading.Tasks.Task>? RequestCancelOrStopBuild { get; set; }
        public Func<QueueItem, System.Threading.Tasks.Task>? RequestRetryBuild { get; set; }
        public Func<QueueItem, string, System.Threading.Tasks.Task>? RequestReplyToBuild { get; set; }
        public Action<QueueItem>? RequestOpenBuildChat { get; set; }

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
        private async void BtnRefreshGitBoard_Click(object sender, RoutedEventArgs e)
        {
            // Manual-only GitHub (Shane, 2026-08-14): this is now the PRIMARY
            // trigger for Git Board GitHub traffic — the background poll was
            // removed. Logged on the shared github.manual-refresh channel (source
            // here; the real outcome/count follows on git-board.data) so every
            // GitHub call this app makes is attributable to a real click.
            ActivityLog.Log("github.manual-refresh",
                "Git Board [manual Refresh click]: forcing a fresh GitHub fetch (GraphQL issues + REST milestones + blocked_by).");
            await RefreshGitBoardWithLoadingFeedbackAsync();
        }

        /// <summary>
        /// Git #1635's disable-button + critter-strip feedback for a manual Git Board
        /// refresh (board fetch + first render + the blocked-by sweep that follows it),
        /// dismissed the moment it genuinely completes rather than on a fixed timer.
        /// Git #1836 — Shane: the Build Queue panel's own refresh button
        /// (BuildQueuePanel.BtnRefreshGitHubTiles, cascaded via FullGitRefreshRequested)
        /// triggers this exact same GitHub fetch but showed none of this feedback,
        /// because MainWindow's FullGitRefreshRequested handler called
        /// PopulateGitTrackerBoard(forceFresh: true) directly instead of going through
        /// this method. Extracted out of BtnRefreshGitBoard_Click so both trigger paths
        /// call the one real implementation — MainWindow's FullGitRefreshRequested
        /// handler now awaits this too — rather than duplicating the animation/disable
        /// logic a second time.
        /// </summary>
        public async System.Threading.Tasks.Task RefreshGitBoardWithLoadingFeedbackAsync()
        {
            // Git #923 — a deliberate click should always mean a real, uncached
            // fetch and a guaranteed repaint. A manual refresh also re-runs the
            // blocked_by sweep immediately (bypass its 3-min throttle), since the
            // whole point of clicking Refresh is "re-check GitHub right now."
            _lastBlockedEnrichUtc = DateTime.MinValue;

            // Git #1635 — Shane: disable the refresh button for the FULL in-flight
            // duration (board fetch + first render + the blocked-by sweep that follows
            // it) and show a critter-crossing loading strip tied to that same real
            // span, dismissed the moment it genuinely completes rather than on a fixed
            // timer. BtnRefreshGitBoard / this method is the only path that actually
            // triggers this GitHub fetch — BtnRefreshChats hits the local dev server's
            // own board endpoint, not GitHub, and Build Watch's "Recheck closures" makes
            // its own separate, much lighter open-issue-numbers call — so neither needs
            // to be disabled here (confirmed by reading both before assuming otherwise).
            BtnRefreshGitBoard.IsEnabled = false;
            GitRefreshLoadingStrip.Visibility = Visibility.Visible;
            IssueChompAnimation.StartRefreshLoadingStrip(GitRefreshStripCanvas);
            var totalSw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                await PopulateGitTrackerBoardAsync(forceFresh: true);
                if (_lastBlockedEnrichTask != null)
                {
                    try { await _lastBlockedEnrichTask; }
                    catch { /* real failures are already logged inside EnrichBlockedStatusAsync itself */ }
                }
            }
            finally
            {
                totalSw.Stop();
                ActivityLog.Log("git-board.data",
                    $"manual Refresh: genuinely complete (fetch + render + blocked sweep) in {totalSw.ElapsedMilliseconds}ms — re-enabling button, dismissing loading strip");
                IssueChompAnimation.StopRefreshLoadingStrip(GitRefreshStripCanvas);
                GitRefreshLoadingStrip.Visibility = Visibility.Collapsed;
                BtnRefreshGitBoard.IsEnabled = true;
            }
        }

        /// <summary>
        /// Git #1629 (root cause 4) — Shane: assigning a chat "doesn't reliably show
        /// up in the Chats panel… no way to manually refresh the panel." The only
        /// forced repaint paths were the 20s background poll or an assign/unassign
        /// action, and even those could be silently short-circuited by an unchanged
        /// board signature. This is the Chats panel's own manual refresh: always a
        /// real fetch AND a guaranteed repaint (forceFresh bypasses the signature
        /// check entirely), same pattern as BtnRefreshGitBoard_Click.
        /// </summary>
        private void BtnRefreshChats_Click(object sender, RoutedEventArgs e)
        {
            ActivityLog.Log("git-board.chats",
                "Chats panel [manual Refresh click]: forcing a fresh board fetch + repaint, bypassing the unchanged-signature short-circuit (Git #1629)");
            PopulateChatsTree(forceFresh: true);
            _ = LoadPinnedQuestionsAsync();
        }

        #region Git #2104 — Pinned Questions (Phase 1 of #2036)
        // One card per OPEN chat_pinned_questions row, rendered directly above the Chats tree
        // (PinnedQuestionsSection/-Host in LeftSidebar.xaml). Detection (#2105) doesn't exist
        // yet, so today the only way a pin appears is the "📌 Pin a Question…" manual/debug
        // context-menu item added to each chat card below — this section only needs to prove
        // the render + resolve mechanism works end to end, not detect anything itself.

        private async System.Threading.Tasks.Task LoadPinnedQuestionsAsync()
        {
            if (_db == null) return;
            List<PinnedQuestion> pins;
            try
            {
                pins = await _db.GetOpenPinnedQuestionsAsync();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("chat.floating", $"pinned-questions load failed: {ex.Message}");
                return;
            }

            PinnedQuestionsHost.Children.Clear();
            foreach (var pq in pins)
                PinnedQuestionsHost.Children.Add(BuildPinnedQuestionCard(pq));
            PinnedQuestionsSection.Visibility = pins.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        /// <summary>
        /// Git #2105 — persistence entry point for active detection. Writes each parsed question
        /// as its OWN chat_pinned_questions row (never bundled), skipping any the DB's partial
        /// unique index already holds open (CreatePinnedQuestionAsync returns false for a dup, not
        /// an error). Returns how many NEW rows were created, and repaints the pinned-questions
        /// panel when any were. Called from FloatingChatWindow's turn-idle probe flow (#2105).
        /// </summary>
        public async System.Threading.Tasks.Task<int> CreatePinnedQuestionsFromDetectionAsync(int chatId, IEnumerable<string> questions)
        {
            if (_db == null || chatId <= 0 || questions == null) return 0;

            int created = 0;
            foreach (var raw in questions)
            {
                var q = raw?.Trim();
                if (string.IsNullOrEmpty(q)) continue;
                try
                {
                    if (await _db.CreatePinnedQuestionAsync(chatId, q)) created++;
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("chat.floating", $"pin-detect create failed for chat {chatId}: {ex.Message}");
                }
            }

            if (created > 0)
            {
                if (Dispatcher.CheckAccess())
                    await LoadPinnedQuestionsAsync();
                else
                    await Dispatcher.InvokeAsync(async () => await LoadPinnedQuestionsAsync());
            }
            return created;
        }

        private Border BuildPinnedQuestionCard(PinnedQuestion pq)
        {
            var card = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 0, 0, 6)
            };

            var content = new StackPanel();

            content.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(pq.ChatTitle) ? "Chat" : pq.ChatTitle,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("Subtext1Brush"),
                TextTrimming = TextTrimming.CharacterEllipsis
            });

            content.Children.Add(new TextBlock
            {
                Text = pq.QuestionText,
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = GetBrush("TextBrush"),
                Margin = new Thickness(0, 3, 0, 6)
            });

            var replyRow = new Grid();
            replyRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            replyRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var replyBox = new TextBox
            {
                Height = 26,
                FontSize = 11,
                Padding = new Thickness(6, 4, 6, 4),
                VerticalContentAlignment = VerticalAlignment.Center,
                Background = GetBrush("MantleBrush"),
                Foreground = GetBrush("TextBrush"),
                BorderBrush = GetBrush("Surface1Brush"),
                CaretBrush = GetBrush("TextBrush")
            };
            Grid.SetColumn(replyBox, 0);
            replyRow.Children.Add(replyBox);

            var sendBtn = new Button
            {
                Content = "Reply",
                Style = (Style)FindResource("PrimaryButton"),
                Padding = new Thickness(10, 3, 10, 3),
                Margin = new Thickness(4, 0, 0, 0)
            };
            Grid.SetColumn(sendBtn, 1);
            replyRow.Children.Add(sendBtn);
            content.Children.Add(replyRow);

            var inlineStatus = new TextBlock
            {
                FontSize = 10,
                Margin = new Thickness(0, 4, 0, 0),
                TextWrapping = TextWrapping.Wrap,
                Visibility = Visibility.Collapsed
            };
            content.Children.Add(inlineStatus);

            async System.Threading.Tasks.Task ResolveViaReplyAsync()
            {
                var text = replyBox.Text?.Trim() ?? "";
                if (string.IsNullOrEmpty(text)) return;

                sendBtn.IsEnabled = false;
                replyBox.IsEnabled = false;
                try
                {
                    var chat = new BoardChat
                    {
                        Id = pq.ChatId,
                        ConversationId = pq.ConversationId,
                        Title = pq.ChatTitle,
                        ClaudeUrl = $"https://claude.ai/chat/{pq.ConversationId}"
                    };

                    var mw = Application.Current.MainWindow as MainWindow;
                    string status = mw != null ? await mw.SendToChatAsync(chat, text) : "no-main-window";

                    if (status == "sent")
                    {
                        if (_db != null) await _db.ResolvePinnedQuestionAsync(pq.Id);
                        ActivityLog.Log("chat.floating", $"pin #{pq.Id} resolved via reply to chat {pq.ConversationId}");
                        await LoadPinnedQuestionsAsync();
                        return; // card is gone — nothing left to update on it
                    }

                    string msg = status switch
                    {
                        "inserted-no-send" => "Reply typed but couldn't auto-send — try again, or send it in the chat directly.",
                        "no-composer" => "Couldn't find the chat composer — is the conversation still loading?",
                        "no-chat" or "no-chat-url" or "no-main-window" => "Couldn't open this chat to reply.",
                        _ => $"Send failed ({status}).",
                    };
                    inlineStatus.Text = msg;
                    inlineStatus.Foreground = GetBrush("RedBrush");
                    inlineStatus.Visibility = Visibility.Visible;
                }
                catch (Exception ex)
                {
                    inlineStatus.Text = $"Send failed: {ex.Message}";
                    inlineStatus.Foreground = GetBrush("RedBrush");
                    inlineStatus.Visibility = Visibility.Visible;
                }
                finally
                {
                    sendBtn.IsEnabled = true;
                    replyBox.IsEnabled = true;
                }
            }

            sendBtn.Click += async (_, _) => await ResolveViaReplyAsync();
            replyBox.PreviewKeyDown += async (s, e) =>
            {
                if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Shift) == 0)
                {
                    e.Handled = true;
                    await ResolveViaReplyAsync();
                }
            };

            card.Child = content;
            return card;
        }
        #endregion

        public void ExpandPanel()
        {
            _isPinned = true;
            PinSidebarIcon.Text = "📌";
        }

        private BuildTrackerApiClient? _api;
        private BuildQueuePostgresClient? _db;
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

        /// <summary>Called once from MainWindow with the shared API client — auto-loads Git issues, Chats, and Manifests on startup so they are immediately available without requiring manual icon clicks.</summary>
        public async void Initialize(BuildTrackerApiClient api, BuildQueuePostgresClient? db = null)
        {
            _api = api;
            _db = db;

            // Git #1629 (root cause 2) — the first Chats render used to race this
            // (slow, live-GitHub) board fetch: both were fired concurrently, and
            // PopulateChatsTree's #1362 synthetic-epic backfill only works once
            // _lastBoardIssues is populated, so the launch render routinely won
            // the race with an empty board and stranded chats linked to a
            // not-yet-locally-synced epic under "Unlinked". Await the first board
            // fetch's genuine completion (success OR failure — the method catches
            // its own network errors and returns) before the first Chats render.
            // No fixed delay involved; this is completion-triggered sequencing.
            await PopulateGitTrackerBoardAsync();

            // Auto-load Chats tree & UI Automation manifests
            PopulateChatsTree();
            PopulateManifestsList();
            _ = LoadPinnedQuestionsAsync();

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
                    _ = LoadPinnedQuestionsAsync();
                };
                _pollTimer.Start();
                ActivityLog.Log("git-board.traffic",
                    "Git Board background poll initialized. Git issues auto-loaded at startup.");
            }
        }

        public LeftSidebar()
        {
            InitializeComponent();
            LoadWorkspaceExplorer(RootWorkspacePath);
            SetupGitWatcher();

            ShaneAppStreamService.Instance.StatusChanged += OnShaneAppStatusChanged;
        }

        private void OnShaneAppStatusChanged()
        {
            Dispatcher.Invoke(() =>
            {
                var svc = ShaneAppStreamService.Instance;
                if (svc.IsRunning)
                {
                    ShaneAppIndicator.Visibility = Visibility.Visible;
                    var label = string.IsNullOrWhiteSpace(svc.CurrentAction) ? "RUNNING" : svc.CurrentAction.ToUpperInvariant();
                    if (label.Length > 20) label = label.Substring(0, 18) + "…";
                    ShaneAppIndicatorLabel.Text = label;
                    ShaneAppIndicator.ToolTip = $"shaneapp:// is executing: {svc.CurrentAction} — Click to open live streaming console";
                }
                else
                {
                    ShaneAppIndicator.Visibility = Visibility.Collapsed;
                }
            });
        }

        private void ShaneAppIndicator_Click(object sender, MouseButtonEventArgs e)
        {
            StreamingConsoleWindow.OpenOrFocus();
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

#pragma warning disable CS0067 // never raised yet — tracked as Git #1706
        public event EventHandler<string>? StartRecordingRequested;
        public event EventHandler? StopRecordingRequested;
#pragma warning restore CS0067

        /// <summary>Git #963/Epic #803 — carries the currently-loaded manifest and target environment so MainWindow can run
        /// it through the same real <c>RunManifestAsync</c> pipeline every other trigger uses. Defaults to Dev.</summary>
        public event EventHandler<(TestManifest Manifest, TargetEnvironment TargetEnv)>? PlayTestRequested;

        /// <summary>Raised when Shane clicks "🚀 Deploy to Staging" — MainWindow owns the real deploy chain
        /// (SSH pull -&gt; #911 migrations+restart -&gt; #805 confirm -&gt; toast). Deliberately a bare signal:
        /// this is a manual, human-only action with no payload, kept separate from the environment selector.</summary>
        public event EventHandler? DeployToStagingRequested;

        public TargetEnvironment GetSelectedTargetEnvironment()
        {
            if (ComboTargetEnvironment?.SelectedItem is ComboBoxItem item && item.Tag is string tag)
            {
                if (tag == "Staging") return TargetEnvironment.Staging;
                if (tag == "Production") return TargetEnvironment.Production;
            }
            return TargetEnvironment.Dev;
        }

        private void ComboTargetEnvironment_SelectionChanged(object sender, SelectionChangedEventArgs e)
        {
            if (TargetEnvWarningBadge == null || TargetEnvWarningText == null) return;
            var env = GetSelectedTargetEnvironment();
            if (env == TargetEnvironment.Dev)
            {
                TargetEnvWarningBadge.Visibility = Visibility.Collapsed;
            }
            else if (env == TargetEnvironment.Staging)
            {
                TargetEnvWarningBadge.Visibility = Visibility.Visible;
                TargetEnvWarningBadge.Background = (System.Windows.Media.Brush)FindResource("PeachBrush");
                TargetEnvWarningText.Text = "⚠️ STAGING";
                TargetEnvWarningText.Foreground = (System.Windows.Media.Brush)FindResource("CrustBrush");
            }
            else
            {
                TargetEnvWarningBadge.Visibility = Visibility.Visible;
                TargetEnvWarningBadge.Background = (System.Windows.Media.Brush)FindResource("RedBrush");
                TargetEnvWarningText.Text = "🚨 PROD";
                TargetEnvWarningText.Foreground = (System.Windows.Media.Brush)FindResource("CrustBrush");
            }
        }

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

            var env = GetSelectedTargetEnvironment();
            PlayTestRequested?.Invoke(this, (_lastLoadedManifest, env));

            // Auto-reset back to Dev after triggering a non-dev run to prevent accidental repeat runs
            if (env != TargetEnvironment.Dev && ComboTargetEnvironment != null)
            {
                ComboTargetEnvironment.SelectedIndex = 0;
            }
        }

        /// <summary>"🚀 Deploy to Staging" click — hands the deploy off to MainWindow (which owns the API
        /// client + toast). Independent of the Target Environment selector: Shane switches that to Staging
        /// himself to run tests only AFTER this deploy confirms.</summary>
        private void BtnDeployToStaging_Click(object sender, RoutedEventArgs e)
        {
            DeployToStagingRequested?.Invoke(this, EventArgs.Empty);
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
        public enum ManifestRunStatus
        {
            NeverRun,
            Passed,
            Failed
        }

        private sealed class ManifestEntry
        {
            public string RelativePath = "";
            public string Area = "";
            public string FileName = "";
            public DateTime CreatedUtc;
            public int? IssueNumber;
            public string? Feature;
            public ManifestRunStatus RunStatus = ManifestRunStatus.NeverRun;
            public string RunSummary = "No runs yet";
            /// <summary>
            /// Shane: "anytime a new test manifest is added, even if it's
            /// been ran by the agent... I need it bold or something so I
            /// can easily find it." Deliberately independent of RunStatus —
            /// a manifest an agent just ran and passed is still "new" until
            /// Shane himself opens it once (see LoadManifestLeaf), not the
            /// moment it gets a run result.
            /// </summary>
            public bool IsNew;
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
        /// Git #984 — reads each manifest into a <see cref="ManifestEntry"/> (area = first path segment, plus real creation time and test history pass/fail status) and hands off to <see cref="RenderManifestTree"/> for the grouped color-coded tree.</summary>
        public void PopulateManifestsList()
        {
            string manifestsDir = Path.Combine(RootWorkspacePath, "test-manifests");
            var entries = new List<ManifestEntry>();

            TestHistoryLookup lookup = new();
            try
            {
                var history = TestHistoryStore.ReadAll(RootWorkspacePath);
                lookup = TestHistoryLookup.BuildLookup(history);
            }
            catch { }

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

                    int? issueNum = null;
                    string? feat = null;
                    try
                    {
                        using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(full));
                        if (doc.RootElement.TryGetProperty("issue", out var ip) && ip.TryGetInt32(out var iv))
                            issueNum = iv;
                        if (doc.RootElement.TryGetProperty("feature", out var fp))
                            feat = fp.GetString();
                    }
                    catch { }

                    var status = ManifestRunStatus.NeverRun;
                    string summary = "No runs yet";

                    lookup.TryGetForManifest(issueNum, feat, out var latest);
                    lookup.TryGetReliability(issueNum, feat, out var reliability);

                    if (latest != null)
                    {
                        if (reliability != null && reliability.IsFlaky)
                        {
                            status = latest.AllPassed ? ManifestRunStatus.Passed : ManifestRunStatus.Failed;
                            summary = $"⚠️ Flaky ({reliability.FlipsCount} flips, {reliability.RecentPassCount}/{reliability.RecentRunsEvaluated} passed) — latest: {(latest.AllPassed ? "Passed" : "Failed")} ({latest.Passed}/{latest.Total})";
                        }
                        else if (reliability != null && reliability.IsRegression)
                        {
                            status = ManifestRunStatus.Failed;
                            summary = $"🚨 Regression (failing last {reliability.CurrentStreak} runs) — {latest.StartedAt.ToLocalTime():g}";
                        }
                        else if (latest.AllPassed)
                        {
                            status = ManifestRunStatus.Passed;
                            summary = $"Passed ({latest.Passed}/{latest.Total}) — {latest.StartedAt.ToLocalTime():g}";
                        }
                        else
                        {
                            status = ManifestRunStatus.Failed;
                            summary = $"Failed ({latest.Failed} failed, {latest.Passed} passed) — {latest.StartedAt.ToLocalTime():g}";
                        }
                    }

                    entries.Add(new ManifestEntry
                    {
                        RelativePath = rel,
                        Area = area,
                        FileName = Path.GetFileName(rel),
                        CreatedUtc = created,
                        IssueNumber = issueNum,
                        Feature = feat,
                        RunStatus = status,
                        RunSummary = summary
                    });
                }
            }

            // "New manifest" tracking — see BuildConsoleSettings.SeenManifestPaths
            // for the full bootstrap story. Bootstrap only ever happens once
            // (the flag flips true here on first run), so an existing install's
            // whole corpus never floods bold on the day this shipped.
            try
            {
                var settings = BuildConsoleSettings.Load();
                if (!settings.ManifestTrackingBootstrapped)
                {
                    settings.SeenManifestPaths = entries.Select(e => e.RelativePath).ToList();
                    settings.ManifestTrackingBootstrapped = true;
                    settings.Save();
                }
                else
                {
                    var seen = new HashSet<string>(settings.SeenManifestPaths, StringComparer.OrdinalIgnoreCase);
                    foreach (var e in entries) e.IsNew = !seen.Contains(e.RelativePath);
                }
            }
            catch { /* display-only feature - a settings read/write failure should never block the list itself */ }

            _manifestEntries = entries;
            int newCount = entries.Count(e => e.IsNew);
            ActivityLog.Log("testing.manifest-list", $"listed {entries.Count} manifest(s) in {manifestsDir}{(newCount > 0 ? $" ({newCount} new)" : "")}");
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
            string searchClean = search.TrimStart('#');

            ManifestFilesTree.Items.Clear();

            var byArea = _manifestEntries
                .GroupBy(e => e.Area)
                .OrderBy(g => g.Key, StringComparer.OrdinalIgnoreCase);

            int shown = 0;
            foreach (var group in byArea)
            {
                bool areaMatches = searching && group.Key.Contains(search, StringComparison.OrdinalIgnoreCase);

                var leaves = group
                    .Where(e =>
                    {
                        if (!searching) return true;
                        if (areaMatches) return true;
                        if (e.FileName.Contains(search, StringComparison.OrdinalIgnoreCase)) return true;
                        if (!string.IsNullOrEmpty(e.Feature) && e.Feature.Contains(search, StringComparison.OrdinalIgnoreCase)) return true;
                        if (e.IssueNumber.HasValue)
                        {
                            string issueStr = e.IssueNumber.Value.ToString();
                            if (issueStr.Contains(searchClean, StringComparison.OrdinalIgnoreCase) ||
                                ($"#{issueStr}").Contains(search, StringComparison.OrdinalIgnoreCase))
                                return true;
                        }
                        return false;
                    })
                    .OrderByDescending(e => e.CreatedUtc)
                    .ThenBy(e => e.FileName, StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (leaves.Count == 0) continue;

                string brushKey = AreaBrushKey(group.Key);
                int newCount = leaves.Count(l => l.IsNew);
                var areaNode = new TreeViewItem
                {
                    Header = MakeAreaHeader(group.Key, leaves.Count, brushKey, newCount),
                    // collapsed by default; auto-expands while searching OR when
                    // it's hiding a new manifest, so "bold so I can easily find
                    // it" doesn't get defeated by the area itself being collapsed.
                    IsExpanded = searching || newCount > 0,
                    ContextMenu = BuildAreaContextMenu(),   // area headers carry no manifest — just bulk expand/collapse
                };

                foreach (var leaf in leaves)
                {
                    var leafNode = new TreeViewItem
                    {
                        Header = MakeLeafHeader(leaf, brushKey),
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
        /// a real count badge (e.g. "copilot-readiness (6)"). newCount &gt; 0 additionally appends an accent
        /// "N NEW" badge so an unexpanded (or non-matching-newCount) area still surfaces that it's hiding a
        /// manifest Shane hasn't opened yet.</summary>
        private FrameworkElement MakeAreaHeader(string area, int count, string brushKey, int newCount = 0)
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

            if (newCount > 0)
            {
                var newBadge = new Border
                {
                    Background = (Brush)FindResource("GreenBrush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Manifest(s) added since you last opened them"
                };
                newBadge.Child = new TextBlock
                {
                    Text = newCount == 1 ? "1 NEW" : $"{newCount} NEW",
                    FontSize = 9,
                    FontWeight = FontWeights.Bold,
                    Foreground = Brushes.Black
                };
                sp.Children.Add(newBadge);
            }
            return sp;
        }

        /// <summary>Git #984 — a leaf (manifest filename) with a thin area-colored bar down its left edge and a clean pass/fail/no-run status indicator.</summary>
        private FrameworkElement MakeLeafHeader(ManifestEntry leaf, string brushKey)
        {
            var dp = new DockPanel();
            dp.Children.Add(new Border
            {
                Width = 3,
                CornerRadius = new CornerRadius(1),
                Background = (Brush)FindResource(brushKey),
                Margin = new Thickness(0, 1, 6, 1),
            }); // DockPanel.Dock defaults to Left → a full-height vertical bar

            string iconGlyph;
            string iconBrushKey;
            switch (leaf.RunStatus)
            {
                case ManifestRunStatus.Passed:
                    iconGlyph = "✓";
                    iconBrushKey = "GreenBrush";
                    break;
                case ManifestRunStatus.Failed:
                    iconGlyph = "✕";
                    iconBrushKey = "RedBrush";
                    break;
                default:
                    iconGlyph = "○";
                    iconBrushKey = "Surface2Brush";
                    break;
            }

            var statusBlock = new TextBlock
            {
                Text = iconGlyph,
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)FindResource(iconBrushKey),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 6, 0),
                ToolTip = leaf.RunSummary
            };
            dp.Children.Add(statusBlock);

            if (leaf.IssueNumber.HasValue)
            {
                var issueBadge = new Border
                {
                    Background = (Brush)FindResource("Surface0Brush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(0, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center
                };
                issueBadge.Child = new TextBlock
                {
                    Text = $"#{leaf.IssueNumber.Value}",
                    FontSize = 10,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("PeachBrush")
                };
                dp.Children.Add(issueBadge);
            }

            string tooltipText = leaf.IssueNumber.HasValue
                ? $"#{leaf.IssueNumber.Value} · {leaf.Feature}\n{leaf.FileName}\n{leaf.RunSummary}"
                : $"{leaf.FileName}\n{leaf.RunSummary}";
            if (leaf.IsNew) tooltipText = "NEW — added since you last opened it\n" + tooltipText;

            // Shane: "anytime a new test manifest is added, even if it's
            // been ran by the agent... I need it bold or something so I can
            // easily find it." Badge goes BEFORE the filename block (which
            // must stay the LAST child so DockPanel's LastChildFill still
            // gives it the remaining width to ellipsis-trim into).
            if (leaf.IsNew)
            {
                var newBadge = new Border
                {
                    Background = (Brush)FindResource("GreenBrush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(0, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = "Added since you last opened it"
                };
                newBadge.Child = new TextBlock { Text = "NEW", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = Brushes.Black };
                dp.Children.Add(newBadge);
            }

            dp.Children.Add(new TextBlock
            {
                Text = leaf.FileName,
                FontSize = 11,
                // Deliberately keyed off IsNew alone, never RunStatus.
                FontWeight = leaf.IsNew ? FontWeights.Bold : FontWeights.Normal,
                Foreground = leaf.IsNew ? (Brush)FindResource("GreenBrush") : (Brush)FindResource("TextBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                VerticalAlignment = VerticalAlignment.Center,
                ToolTip = tooltipText
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

            MarkManifestSeen(fileName);

            return manifest;
        }

        /// <summary>
        /// Shane's "new manifest" bold/badge treatment (see ManifestEntry.IsNew
        /// / BuildConsoleSettings.SeenManifestPaths) clears the moment HE opens
        /// the manifest here — not when an agent runs it — so a just-added,
        /// already-run manifest still reads as new until he's actually looked
        /// at it. No-ops (no write, no re-render) when the leaf wasn't new.
        /// </summary>
        private void MarkManifestSeen(string relativePath)
        {
            var entry = _manifestEntries.FirstOrDefault(e => e.RelativePath == relativePath);
            if (entry == null || !entry.IsNew) return;

            entry.IsNew = false;
            try
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.SeenManifestPaths.Contains(relativePath, StringComparer.OrdinalIgnoreCase))
                {
                    settings.SeenManifestPaths.Add(relativePath);
                    settings.Save();
                }
            }
            catch { /* display-only feature - a save failure just means it re-shows as new next scan */ }

            RenderManifestTree();
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

            var env = GetSelectedTargetEnvironment();
            PlayTestRequested?.Invoke(this, (manifest, env));
            if (env != TargetEnvironment.Dev && ComboTargetEnvironment != null)
            {
                ComboTargetEnvironment.SelectedIndex = 0;
            }
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
        /// (LoadManifestLeaf → PlayTestRequested). View Run Diagram / View Raw JSON / Edit all open the
        /// dedicated ManifestViewerWindow — Edit and View Raw JSON both land on its (now-editable) JSON
        /// view, View Run Diagram on its workflow-chart view. Copy Path / Reveal in Explorer mirror
        /// CreateExplorerContextMenu exactly.</summary>
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
                if (manifest != null)
                {
                    var env = GetSelectedTargetEnvironment();
                    PlayTestRequested?.Invoke(this, (manifest, env));
                    if (env != TargetEnvironment.Dev && ComboTargetEnvironment != null)
                    {
                        ComboTargetEnvironment.SelectedIndex = 0;
                    }
                }
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

            // 4. Edit — opens the Manifest Viewer's (now-editable, Git #1052-ish) Raw JSON view, which has
            // a real Ctrl+S / Save button that validates and writes back to this exact file. The generic
            // Monaco tab (FileSelected → OpenFileTab) has no save bridge at all for any file, so it was a
            // dead end for "Edit" specifically — Shane: opening a manifest to edit it had no working save.
            var miEdit = new MenuItem { Header = "Edit" };
            miEdit.Click += (s, e) => OpenManifestViewerFromPath(fullPath, showChartFirst: false);
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
            GraphApiView.Visibility   = view == "GraphApi"   ? Visibility.Visible : Visibility.Collapsed;

            HeaderTitle.Text = view == "Automation" ? "UI AUTOMATION" : (view == "Issues" ? "GIT BOARD" : (view == "GraphApi" ? "GRAPH API PANEL" : view.ToUpperInvariant()));

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
            else if (view == "GraphApi")
            {
                PopulateGraphApiTree();
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

            // forceFresh must be fresh all the way down: pass it through as
            // bypassCache so the GitHubApiClient ETag conditional is skipped too
            // (otherwise GitHub can 304 us with a stale milestone-count body and the
            // manual Refresh silently returns the old open/closed counts — the exact
            // "progress bar stuck at 20/35" bug this closes; see GetConditionalAsync).
            var fetched = await client.GetMilestonesAsync(bypassCache: forceFresh);
            _cachedMilestoneInfos = fetched;
            _lastMilestonesFetchUtc = DateTime.UtcNow;
            return fetched;
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
        public async void PopulateGitTrackerBoard(bool forceFresh = false) =>
            await PopulateGitTrackerBoardAsync(forceFresh);

        /// <summary>Git #1629 (root cause 2) — the awaitable core of
        /// <see cref="PopulateGitTrackerBoard"/>, so <see cref="Initialize"/> can
        /// genuinely sequence the first Chats render after the first board fetch
        /// completes instead of firing both concurrently. All network failures are
        /// caught internally, so awaiting this always completes.</summary>
        public async System.Threading.Tasks.Task PopulateGitTrackerBoardAsync(bool forceFresh = false)
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
            // Git #1635 — rough per-stage Stopwatch timing around a real manual
            // refresh, logged once per stage on the existing git-board.data channel,
            // so "is it the fetch, the render, or the blocked sweep that's slow" is
            // an actual measured fact from now on instead of a guess. See this
            // issue's own investigation for the before-fix numbers this replaced.
            var fetchSw = System.Diagnostics.Stopwatch.StartNew();
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
            fetchSw.Stop();

            ActivityLog.Log("git-board.data",
                $"loaded {issues.Count} open issue(s), {issues.Count(i => i.IsEpic)} epic(s) — GraphQL+milestone fetch took {fetchSw.ElapsedMilliseconds}ms");

            // Shane, 2026-08-28: "when a build is in Verifying state and then
            // the Git issue behind it is closed, it should change to closed
            // [done] and hide." #1469 already built the promotion rule
            // (PromoteVerifyingToDoneAsync) but only wired it into the Home
            // tab's manual refresh — a Git Board refresh triggered from the
            // Build Queue panel's own refresh button never ran it, so a
            // Verifying item sat there until Home was opened. This board
            // fetch already has a fresh real open-issue set (`issues`, State
            // == OPEN) for free, so reuse it here too. VerifyingIssuesPromoted
            // lets MainWindow tell the Build Queue panel to redraw immediately
            // instead of waiting for its own next poll.
            // Git #1632 — hoisted out of the `_db != null` block below so it's also
            // available for GitBoardOpenIssuesRefreshed further down, which fires
            // regardless of whether _db is configured.
            var openNumbersForPromotion = issues.Where(i => i.State == "OPEN").Select(i => i.Number).ToHashSet();
            if (_db != null)
            {
                try
                {
                    var promoted = await _db.PromoteVerifyingToDoneAsync(openNumbersForPromotion);
                    if (promoted.Count > 0)
                    {
                        ActivityLog.Log("git-board.data",
                            $"Verifying → Done (issue closed): {promoted.Count} queue item(s) — " +
                            string.Join(", ", promoted.Select(p => $"#{p.Id} (GH #{p.GithubNumber})")));
                        VerifyingIssuesPromoted?.Invoke(this, EventArgs.Empty);
                    }

                    // Git #2136 / #2486 — also reconcile pre-dispatch rows (Verifying AND still-
                    // queued) whose real board Status column moved: Verifying→Park/Crashed/Done,
                    // and a queued row moved to Backlog/Park/Crashed/Done. Git is the database.
                    int reconciled = await BuildConsole.Services.BoardStatusSync.ReconcileQueueAgainstBoardAsync(_db, "Git Board refresh");
                    if (reconciled > 0)
                        VerifyingIssuesPromoted?.Invoke(this, EventArgs.Empty);
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.data", $"Verifying→Done promotion FAILED (will retry next refresh): {ex.Message}");
                }
            }

            // Git #1600 — this fetch just proved GitHub is reachable and got a fresh
            // look at it; that's exactly the moment to kick an immediate re-check of
            // any queue item currently HELD on a blocker, so a build releases right
            // away once its real blocker closes instead of waiting out the watcher's
            // own poll interval. Fired on every successful fetch, not just when a
            // Verifying item got promoted above.
            BoardRefreshCompleted?.Invoke(this, EventArgs.Empty);

            // Git #1632 — hand the same fresh open-issue set to any open Build Watch
            // window (via MainWindow) so it can evict closed-issue slots and promote
            // Verifying→Done for free, off this fetch. Reuses openNumbersForPromotion
            // computed just above for the same purpose — no second computation, no
            // extra `gh` call.
            GitBoardOpenIssuesRefreshed?.Invoke(this, openNumbersForPromotion);

            _boardShowsClosed = false;

            // 1. Check for issues/epics closed remotely (e.g. by Claude on GitHub)
            if (_lastBoardIssues != null && _lastBoardIssues.Count > 0)
            {
                var newOpenNumbers = issues.Where(i => i.State == "OPEN").Select(i => i.Number).ToHashSet();
                var newlyClosedIssues = _lastBoardIssues
                    .Where(old => !old.IsClosed && !newOpenNumbers.Contains(old.Number))
                    .ToList();

                if (newlyClosedIssues.Count > 0)
                {
                    ActivityLog.Log("git-board.critters", $"Detected {newlyClosedIssues.Count} issue(s) closed remotely (Claude/PR) — sending in critters to devour them!");
                    int delayMs = 0;
                    foreach (var closedIssue in newlyClosedIssues)
                    {
                        int currentDelay = delayMs;
                        string issueLabel = $"#{closedIssue.Number} {closedIssue.Title}";
                        var tvi = FindIssueTreeViewItem(IssuesTree.Items, closedIssue.Number);
                        bool isEpic = closedIssue.IsEpic;
                        
                        if (currentDelay == 0)
                        {
                            if (isEpic)
                                IssueChompAnimation.PlayEpic(tvi, issueLabel);
                            else
                                IssueChompAnimation.Play(tvi, issueLabel);
                        }
                        else
                        {
                            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(currentDelay) };
                            timer.Tick += (_, _) =>
                            {
                                timer.Stop();
                                if (isEpic)
                                    IssueChompAnimation.PlayEpic(tvi, issueLabel);
                                else
                                    IssueChompAnimation.Play(tvi, issueLabel);
                            };
                            timer.Start();
                        }
                        delayMs += isEpic ? 700 : 400;
                    }
                }

                // 1b. Check for issues created remotely since the last fetch —
                // Shane: "More work is added with new Issues created... this
                // little guy should be grumpy, sad... Mo Work!" The exact
                // mirror of the newlyClosedIssues check above (same guard
                // against a false flood on the very first-ever board load),
                // but a NEW issue never had a tree row before, so its tvi is
                // always null — PlayMoWork falls back to a default on-screen
                // position when targetElement is null, same as every other
                // critter animation already handles.
                var oldNumbers = _lastBoardIssues.Select(o => o.Number).ToHashSet();
                var newlyCreatedIssues = issues
                    .Where(cur => cur.State == "OPEN" && !oldNumbers.Contains(cur.Number))
                    .ToList();

                if (newlyCreatedIssues.Count > 0)
                {
                    ActivityLog.Log("git-board.critters", $"Detected {newlyCreatedIssues.Count} new issue(s) created remotely — sending in the grump. Mo' work...");
                    int delayMs = 0;
                    foreach (var newIssue in newlyCreatedIssues)
                    {
                        int currentDelay = delayMs;
                        string issueLabel = $"#{newIssue.Number} {newIssue.Title}";

                        if (currentDelay == 0)
                        {
                            IssueChompAnimation.PlayNewWork(null, issueLabel);
                        }
                        else
                        {
                            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(currentDelay) };
                            timer.Tick += (_, _) =>
                            {
                                timer.Stop();
                                IssueChompAnimation.PlayNewWork(null, issueLabel);
                            };
                            timer.Start();
                        }
                        delayMs += 500;
                    }
                }
            }

            // 2. Check for milestones that reached 100% completion (Milestone Conquered -> Huge Parade!)
            if (_lastMilestoneInfos != null && _lastMilestoneInfos.Count > 0)
            {
                var newlyFinishedMilestones = milestoneInfos
                    .Where(cur => cur.OpenIssues == 0 && cur.ClosedIssues > 0)
                    .Where(cur => _lastMilestoneInfos.Any(prev => prev.Number == cur.Number && prev.OpenIssues > 0))
                    .ToList();

                if (newlyFinishedMilestones.Count > 0)
                {
                    ActivityLog.Log("git-board.critters", $"Detected {newlyFinishedMilestones.Count} milestone(s) completed — triggering HUGE CRITTER PARADE & BIG PARTY!");
                    int paradeDelay = 0;
                    foreach (var m in newlyFinishedMilestones)
                    {
                        var mTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(paradeDelay) };
                        mTimer.Tick += (_, _) =>
                        {
                            mTimer.Stop();
                            IssueChompAnimation.PlayMilestoneParade(null, m.Title);
                        };
                        mTimer.Start();
                        paradeDelay += 3500;
                    }
                }
            }
            _lastMilestoneInfos = milestoneInfos;
            if (milestoneInfos != null && milestoneInfos.Count > 0)
            {
                var activeM = milestoneInfos.FirstOrDefault(m => m.OpenIssues > 0) ?? milestoneInfos[0];
                BuildConsole.Services.EncouragementService.Instance.UpdateMilestoneProgress(activeM.Title, activeM.OpenIssues, activeM.ClosedIssues);
            }

            // Git #923 — milestoneInfos folded in (Number/Title/counts per
            // milestone), not just the open-issues list - see this method's
            // own doc comment above for why issues alone missed milestone-
            // only changes (deletes/merges with no open-issue side effect).
            var signature = System.Text.Json.JsonSerializer.Serialize(new
            {
                Issues = issues.Select(i => new { i.Number, i.Title, i.State, i.SubIssueCount, i.MilestoneTitle, i.ParentNumber, i.ParentMilestoneNumber }),
                Milestones = milestoneInfos!.Select(m => new { m.Number, m.Title, m.OpenIssues, m.ClosedIssues }),
            });
            if (!forceFresh && signature == _lastInProgressSignature) return;
            _lastInProgressSignature = signature;

            var buildSw = System.Diagnostics.Stopwatch.StartNew();
            await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.Background);
            BuildBoardFromGitHub(issues, milestoneInfos!);

            // Git #1977 — a Focus Mode milestone that has reached 100% (all issues
            // closed) or been closed on GitHub drops off the OPEN-only board entirely
            // (BuildBoardFromGitHub above only keeps milestones with open issues plus
            // non-closed real milestones — see #884/#925). Left focused, the hard
            // filter IsMilestoneInFocus then matches NONE of the milestones actually on
            // the board, so RenderIssuesTree's `shownMilestones` is empty and the whole
            // Git Board — tree AND all four summary counts (Active Milestones/Epics/
            // Pending/Done) — reads zero, even though `_milestones` correctly holds
            // every fetched issue. That was the exact "439 fetched, board blank" report:
            // the blocked-by sweep still counted 439 open issues off `_milestones`, but
            // the focus-filtered render drew nothing. Detect that stale-focus state here
            // — using the real, just-built tree milestone set — and auto-release Focus so
            // the board falls back to showing everything instead of blanking. Guarded on
            // a non-empty `_milestones` (never fire on a cold/failed fetch) and left
            // alone while the immersive full-screen view is up (don't yank it out from
            // under Shane mid-celebration; the next refresh releases it once he exits).
            var focusSvc = BuildConsole.Services.FocusModeService.Instance;
            if (focusSvc.IsActive && !focusSvc.ImmersiveActive && _milestones.Count > 0
                && !_milestones.Any(m => focusSvc.IsMilestoneInFocus(m.GithubNumber, m.Title)))
            {
                ActivityLog.Log("focus-mode",
                    $"active milestone '{focusSvc.ActiveMilestoneTitle}' (#{focusSvc.ActiveMilestoneNumber}) is no longer present on the open board " +
                    "(100% complete / closed) — auto-releasing Focus so the Git Board isn't filtered to nothing (Git #1977).");
                focusSvc.Deactivate();
            }

            // Feed Focus Mode the real issue→milestone map + milestone counts (this is the
            // OPEN board fetch; the closed-view BuildBoardFromGitHub call deliberately does NOT
            // feed, so the filter map isn't overwritten with closed-only issues).
            BuildConsole.Services.FocusModeService.Instance.UpdateBoardSnapshot(
                issues, milestoneInfos!,
                trigger: forceFresh ? "manual Git refresh" : "board update");
            await RenderIssuesTreeAsync(_currentFilter == "Done" ? "All" : _currentFilter);
            buildSw.Stop();
            // Git #1635 measured this rebuild at ~1.5-2s of continuous UI-thread
            // blocking; #1679 chunked it across dispatcher frames, so this wall
            // time now includes yielded frames where input/animation ran — the
            // per-burst blocking breakdown is in RenderIssuesTree's own
            // "(chunked, #1679)" log line right above this one.
            ActivityLog.Log("git-board.data",
                $"BuildBoardFromGitHub + first RenderIssuesTree took {buildSw.ElapsedMilliseconds}ms wall (chunked) for {issues.Count} issue(s)");

            // Closed-epic filtering (RenderChatsTree signal B) reads this fresh
            // open-issue set, so re-render the already-populated Chats tree from
            // its cache now that _lastBoardIssues has changed — a just-closed
            // epic drops out of Chats immediately instead of lingering until the
            // next Chats poll. Cache-only (no network); no-op before chats load.
            // Git #1629 — run the #1362 synthetic-epic backfill FIRST: it used to
            // live only inside PopulateChatsTree, so this repaint rendered with the
            // stale (un-backfilled) epic map and a chat linked to an epic this fetch
            // just surfaced stayed stranded under Unlinked until the next Chats poll.
            if (_lastBoardChats.Count > 0) { try { BackfillSyntheticEpicsFromBoard(); RenderChatsTree(); } catch { } }

            // Git #845 (Git Board Phase 7) — the board's own GraphQL fetch above
            // has no issue-dependency data, so blocked state is enriched in a
            // second pass via the real REST blocked_by endpoint (bounded
            // concurrency so a board full of open issues doesn't hammer GitHub
            // all at once), then the tree repaints once with the real result.
            // Git #1635 — captured into _lastBlockedEnrichTask (still fire-and-forget
            // for every OTHER caller of this method, unchanged) so BtnRefreshGitBoard_Click
            // can await the manual refresh's REAL total completion — fetch, first render,
            // AND this sweep — before re-enabling the button / dismissing the loading strip.
            _lastBlockedEnrichTask = EnrichBlockedStatusAsync(settings.GitHubPat);
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
        /// <summary>
        /// Git #842 (Git Board Phase 4) — opens NewIssueDialog and creates an issue on GitHub, optionally under a specific milestone.
        /// </summary>
        public async System.Threading.Tasks.Task CreateNewIssueAsync(int? milestoneNumber = null, string prefillTitle = "")
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ToastEngine.Warning("New Issue", "No GitHub PAT configured — set one in Settings (cog icon / File > Settings) first.");
                return;
            }

            var epicCandidates = _lastBoardIssues.Where(i => i.IsEpic).OrderByDescending(i => i.Number).ToList();
            var dialog = new NewIssueDialog(epicCandidates, prefillTitle);
            dialog.Owner = Application.Current.MainWindow;
            if (dialog.ShowDialog() != true) return;

            var client = new GitHubApiClient(settings.GitHubPat);
            CreatedIssue created;
            try
            {
                created = await client.CreateIssueAsync(dialog.IssueTitle, dialog.IssueBody, milestoneNumber);
            }
            catch (Exception ex)
            {
                ActivityLog.Log("git-board.create", $"issue creation FAILED: {ex.Message}");
                ToastEngine.Error("New Issue", $"Couldn't create the issue: {ex.Message}");
                return;
            }

            ActivityLog.Log("git-board.create", $"created #{created.Number} \"{dialog.IssueTitle}\"" + (milestoneNumber.HasValue ? $" in milestone #{milestoneNumber}" : ""));
            ToastEngine.Success("Git Board", $"Issue #{created.Number} created successfully!");

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
        /// <summary>
        /// Git #845 (Git Board Phase 7) — real still-OPEN blocked_by dependency
        /// check (EnrichBlockedStatusAsync), cached for 3 minutes so frequent
        /// board polls (every 10s) don't spam GitHub's REST API.
        /// </summary>
        private DateTime _lastBlockedEnrichUtc = DateTime.MinValue;
        private static readonly TimeSpan BlockedEnrichMinInterval = TimeSpan.FromMinutes(3);
        private HashSet<int>? _knownBlockedIssueNumbers;

        /// <summary>Git #1635 — the most recently-started EnrichBlockedStatusAsync task,
        /// so BtnRefreshGitBoard_Click can await the manual refresh's REAL total
        /// completion (fetch + first render + this sweep) before re-enabling the button
        /// and dismissing the loading strip. Every other caller still fires this
        /// fire-and-forget, unchanged — only the manual-refresh click actually awaits it.</summary>
        private System.Threading.Tasks.Task? _lastBlockedEnrichTask;

        /// <summary>
        /// Git #1367 — persistent last-known blocked_by result (open issue number ->
        /// its still-open blocker), kept ACROSS board rebuilds. Root cause of the
        /// disappearing-Blocked-badge bug: the board's GraphQL fetch carries no
        /// issue-dependency data, so every <see cref="BuildBoardFromGitHub"/> rebuilds
        /// its <see cref="GitIssue"/> objects with IsBlocked=false, and the only thing
        /// that sets it true — <see cref="EnrichBlockedStatusAsync"/> — is throttled to
        /// <see cref="BlockedEnrichMinInterval"/>. Any board rebuild inside that throttle
        /// window (an unrelated issue's GraphQL signature changing across this busy repo)
        /// therefore repainted the badge away until Shane's next manual refresh reset the
        /// throttle. MapBucket now reseeds each fresh GitIssue from this cache so the badge
        /// stays stable between refreshes; EnrichBlockedStatusAsync rebuilds it
        /// authoritatively from the real REST result each time it actually runs.
        /// </summary>
        private readonly Dictionary<int, (int? Number, string? Title)> _blockedStatusCache = new();

        private async System.Threading.Tasks.Task EnrichBlockedStatusAsync(string pat)
        {
            if (DateTime.UtcNow - _lastBlockedEnrichUtc < BlockedEnrichMinInterval) return;
            _lastBlockedEnrichUtc = DateTime.UtcNow;

            var openIssues = _milestones.SelectMany(m => m.Epics).SelectMany(e => e.Issues)
                .Where(i => i.Status != "CLOSED").ToList();
            if (openIssues.Count == 0) return;

            // Git #1635 — measured for real against this repo's live open-issue count
            // (257 issues, concurrency=6): ~6.4s of real wall time. It's async — it
            // does NOT block the UI thread the way the RenderIssuesTree rebuild below
            // does — but nothing visibly happens for that whole span, which Shane's
            // own words called "indistinguishable from a freeze." Left at concurrency=6
            // rather than raised: Git #876 is the standing reason this repo has a
            // conservative REST concurrency cap here at all ("Something is causing a
            // git refresh a lot and I am being rate limited quickly"), and the required
            // button-disable + critter loading strip (BtnRefreshGitBoard_Click) already
            // solves the "looks frozen" complaint without reopening that rate-limit risk.
            var sweepSw = System.Diagnostics.Stopwatch.StartNew();

            var client = new GitHubApiClient(pat);
            using var gate = new System.Threading.SemaphoreSlim(6);
            var newlyBlocked = new List<(GitIssue issue, int? blockerNumber)>();
            var newlyUnblocked = new List<(GitIssue issue, int? wasBlockedBy)>();

            await System.Threading.Tasks.Task.WhenAll(openIssues.Select(async issue =>
            {
                await gate.WaitAsync();
                try
                {
                    var blocker = await client.GetOpenBlockedByAsync(issue.IssueNumber);
                    bool wasBlocked = _knownBlockedIssueNumbers != null && _knownBlockedIssueNumbers.Contains(issue.IssueNumber);
                    // Git #1367 — this REST result is authoritative: the issue is
                    // blocked iff it still has an open blocked_by dependency right now.
                    // (Previously OR'd with the incoming issue.IsBlocked, which now
                    // arrives pre-seeded true from _blockedStatusCache and would have
                    // made a remotely-unblocked issue stick as blocked forever and
                    // suppressed the unblock detection below.) A transient fetch failure
                    // throws into the catch and leaves the seeded value untouched, so the
                    // badge survives a hiccup rather than flickering off.
                    issue.IsBlocked = blocker != null;
                    issue.BlockedByNumber = blocker?.Number;
                    issue.BlockedByTitle = blocker?.Title;

                    if (issue.IsBlocked && _knownBlockedIssueNumbers != null && !_knownBlockedIssueNumbers.Contains(issue.IssueNumber))
                    {
                        lock (newlyBlocked)
                        {
                            newlyBlocked.Add((issue, blocker?.Number));
                        }
                    }
                    else if (!issue.IsBlocked && wasBlocked)
                    {
                        lock (newlyUnblocked)
                        {
                            newlyUnblocked.Add((issue, blocker?.Number));
                        }
                    }
                }
                catch { /* best-effort — worst case this one issue just doesn't show a Blocked badge */ }
                finally { gate.Release(); }
            }));

            sweepSw.Stop();
            var previousKnownBlocked = _knownBlockedIssueNumbers;
            _knownBlockedIssueNumbers = openIssues.Where(i => i.IsBlocked).Select(i => i.IssueNumber).ToHashSet();

            // Git #1367 — refresh the cross-rebuild cache from this authoritative pass
            // so any board rebuild that lands inside the next throttle window reseeds the
            // badge (see _blockedStatusCache / MapBucket). Rebuilt from scratch each run,
            // so a remotely-unblocked issue correctly drops out and the cache never
            // accumulates stale entries.
            _blockedStatusCache.Clear();
            foreach (var i in openIssues.Where(i => i.IsBlocked))
                _blockedStatusCache[i.IssueNumber] = (i.BlockedByNumber, i.BlockedByTitle);

            // Git #1635 — the second candidate freeze cause this issue asked to measure:
            // RenderIssuesTree does a full, un-virtualized, imperative rebuild of every
            // milestone/epic/issue TreeViewItem+ContextMenu, synchronously on the UI
            // thread (measured ~1.5-2s at this repo's real scale, JIT-warm) — and this
            // was called UNCONDITIONALLY here, a second time, on top of the one
            // PopulateGitTrackerBoardAsync already did moments earlier, even when the
            // sweep confirmed nothing actually changed. Skip it in that case (the
            // option this issue's own body suggested): re-render only when this is the
            // very first sweep this session (previousKnownBlocked == null — nothing was
            // rendered with real blocked state yet) or the confirmed blocked-issue set
            // actually differs from what's already on screen.
            bool blockedSetChanged = previousKnownBlocked == null || !previousKnownBlocked.SetEquals(_knownBlockedIssueNumbers);
            if (blockedSetChanged)
            {
                var renderSw = System.Diagnostics.Stopwatch.StartNew();
                await RenderIssuesTreeAsync(_currentFilter == "Done" ? "All" : _currentFilter);
                renderSw.Stop();
                ActivityLog.Log("git-board.data",
                    $"blocked-by sweep ({openIssues.Count} issue(s), concurrency=6) took {sweepSw.ElapsedMilliseconds}ms, " +
                    $"blocked state changed — second RenderIssuesTree took {renderSw.ElapsedMilliseconds}ms wall (chunked, #1679)");
            }
            else
            {
                ActivityLog.Log("git-board.data",
                    $"blocked-by sweep ({openIssues.Count} issue(s), concurrency=6) took {sweepSw.ElapsedMilliseconds}ms, " +
                    "confirmed no change — skipped the redundant second RenderIssuesTree");
            }

            // If issues became blocked remotely (e.g. by Claude on GitHub), send in the Whammy!
            if (newlyBlocked.Count > 0)
            {
                ActivityLog.Log("git-board.whammy", $"Detected {newlyBlocked.Count} issue(s) blocked remotely — sending in the Whammy!");
                int delay = 0;
                foreach (var (bIssue, blockerNum) in newlyBlocked)
                {
                    int curDelay = delay;
                    var tvi = FindIssueTreeViewItem(IssuesTree.Items, bIssue.IssueNumber);
                    string label = $"#{bIssue.IssueNumber} {bIssue.RawTitle}";
                    if (curDelay == 0)
                    {
                        IssueChompAnimation.PlayBlocked(tvi, label, blockerNum);
                    }
                    else
                    {
                        var wTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(curDelay) };
                        wTimer.Tick += (_, _) =>
                        {
                            wTimer.Stop();
                            IssueChompAnimation.PlayBlocked(tvi, label, blockerNum);
                        };
                        wTimer.Start();
                    }
                    delay += 800;
                }
            }

            // If issues became unblocked remotely (blocker resolved/unlinked), send in Sparky the Keymaster Bunny!
            if (newlyUnblocked.Count > 0)
            {
                ActivityLog.Log("git-board.unblock", $"Detected {newlyUnblocked.Count} issue(s) unblocked — sending in Sparky the Keymaster Bunny!");
                int delay = 0;
                foreach (var (uIssue, wasBlockerNum) in newlyUnblocked)
                {
                    int curDelay = delay;
                    var tvi = FindIssueTreeViewItem(IssuesTree.Items, uIssue.IssueNumber);
                    string label = $"#{uIssue.IssueNumber} {uIssue.RawTitle}";
                    if (curDelay == 0)
                    {
                        IssueChompAnimation.PlayUnblock(tvi, label, wasBlockerNum);
                    }
                    else
                    {
                        var uTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(curDelay) };
                        uTimer.Tick += (_, _) =>
                        {
                            uTimer.Stop();
                            IssueChompAnimation.PlayUnblock(tvi, label, wasBlockerNum);
                        };
                        uTimer.Start();
                    }
                    delay += 800;
                }
            }
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
        private List<GitHubApiClient.GitHubMilestoneInfo> _lastMilestoneInfos = new();

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
            var issueInTree = _milestones.SelectMany(m => m.Epics).SelectMany(e => e.Issues).FirstOrDefault(i => i.IssueNumber == number);
            return new GitIssue
            {
                IssueNumber = it.Number,
                Title = it.IsEpic ? $"{it.Title}  ({it.SubIssueCount} sub)" : it.Title,
                RawTitle = it.Title,
                Priority = it.IsTodo ? "HIGH" : "MED",
                Status = it.IsClosed ? "CLOSED" : "OPEN",
                IsComplete = it.IsComplete,
                Body = it.Body,
                DatabaseId = it.DatabaseId,
                IsEpic = it.IsEpic,
                HasParentEpic = it.ParentNumber != null,
                ParentNumber = it.ParentNumber,
                SubIssueCount = it.SubIssueCount,
                IsBlocked = issueInTree?.IsBlocked ?? it.IsBlocked,
                IsInFlight = it.HasInFlightLabel,
                BlockedByNumber = issueInTree?.BlockedByNumber,
                BlockedByTitle = issueInTree?.BlockedByTitle,
                Labels = it.Labels,
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
                    // Git #1367 — reseed blocked state from the persistent cache so the
                    // Blocked badge survives a board rebuild between the throttled
                    // EnrichBlockedStatusAsync passes. The GraphQL fetch carries no
                    // issue-dependency data (it.IsBlocked is always false here), so
                    // without this reseed the badge vanished on any rebuild that landed
                    // inside the enrich throttle window and only came back on Shane's
                    // next manual refresh (which resets that throttle).
                    bool cachedBlocked = _blockedStatusCache.TryGetValue(it.Number, out var cachedBlk);
                    epic.Issues.Add(new GitIssue
                    {
                        IssueNumber = it.Number,
                        Title = it.IsEpic ? $"{it.Title}  ({it.SubIssueCount} sub)" : it.Title,
                        RawTitle = it.Title,
                        Priority = it.IsTodo ? "HIGH" : "MED",
                        Status = it.IsClosed ? "CLOSED" : "OPEN",
                        IsComplete = it.IsComplete,
                        IsBlocked = it.IsBlocked || cachedBlocked,
                        BlockedByNumber = cachedBlocked ? cachedBlk.Number : (int?)null,
                        BlockedByTitle = cachedBlocked ? cachedBlk.Title : null,
                        IsInFlight = it.HasInFlightLabel,
                        Labels = it.Labels,
                        SqlPath = DeriveSqlPath(it.Body),
                        Body = it.Body,
                        DatabaseId = it.DatabaseId,
                        IsEpic = it.IsEpic,
                        HasParentEpic = it.ParentNumber != null,
                        ParentNumber = it.ParentNumber,
                        SubIssueCount = it.SubIssueCount,
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
                var milestoneNumber = list.FirstOrDefault(i => i.MilestoneNumber.HasValue)?.MilestoneNumber;
                var info = (milestoneNumber.HasValue && milestoneInfoByNumber.TryGetValue(milestoneNumber.Value, out var foundInfo))
                    ? foundInfo
                    : milestoneInfos.FirstOrDefault(mi => string.Equals(mi.Title, g.Key, StringComparison.OrdinalIgnoreCase));

                if (info != null)
                {
                    milestone.TotalCount = info.OpenIssues + info.ClosedIssues;
                    milestone.CompletedCount = info.ClosedIssues;
                    milestone.HasRealCounts = true;
                    // Git #921 — carry the real number + raw open/closed counts so the milestone detail tab shows them as separate pills.
                    milestone.GithubNumber = info.Number;
                    milestone.OpenIssues = info.OpenIssues;
                    milestone.ClosedIssues = info.ClosedIssues;
                    milestone.State = info.State;
                    seenMilestoneNumbers.Add(info.Number);
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
            // Git #925 — Don't add CLOSED milestones to the active OPEN board.
            foreach (var mi in milestoneInfos)
            {
                if (seenMilestoneNumbers.Contains(mi.Number)) continue;
                if (mi.IsClosed && !_boardShowsClosed) continue;
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
                    State = mi.State,
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
        /// <summary>Git #1629 (root cause 4) — <paramref name="forceFresh"/> skips the
        /// unchanged-signature short-circuit entirely, guaranteeing a real repaint. Used by
        /// the Chats panel's manual Refresh button and by actions (e.g. mark-in-progress)
        /// whose visible effect isn't part of the raw board payload — same pattern
        /// <see cref="PopulateGitTrackerBoard"/>'s own forceFresh already follows.</summary>
        public async void PopulateChatsTree(bool forceFresh = false)
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
                if (_db != null)
                {
                    board = await _db.GetBoardAsync();
                    isStale = false;
                    cachedAtUtc = null;
                }
                else
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
            }
            catch (Exception ex)
            {
                ShowChatsMessage($"Couldn't reach the API: {ex.Message}");
                SyncError?.Invoke(this, $"Chats: {ex.Message}");
                return;
            }

            // Git #1480 — bt_chats.account doesn't exist yet (migration not run). Show an
            // explicit "database not ready" state rather than rendering a Chats panel that
            // LOOKS scoped to the current account but isn't really — same honest-failure
            // pattern as #1472. Only the direct-Postgres path (_db) detects this; see
            // BuildQueuePostgresClient.GetBoardAsync's PostgresException catch.
            if (board.AccountColumnMissing)
            {
                ActivityLog.Log("git-board.chats",
                    "Chats panel blocked: bt_chats.account column missing — run lib/db/migrations/manual/2026-08-28-bt-chats-account-1480.sql (Git #1480)");
                ShowChatsMessage("Chats panel database not ready — the `account` column hasn't been added to bt_chats yet. Ask Shane to run lib/db/migrations/manual/2026-08-28-bt-chats-account-1480.sql.");
                return;
            }

            // Git #851 — cached even when the signature is unchanged below
            // (that check only guards the TREE rebuild) so BuildQueuePanel's
            // "open the chat for this issue" click always has the latest
            // real chat list to search, not just whatever happened to be
            // cached the last time the tree actually re-rendered.
            _lastBoardChats = board.Chats;
            _chatEpicById = board.Epics.ToDictionary(e => e.Id);

            // Git #1362 — resilience against a stale local bt_epics table. A chat
            // is grouped under its epic ENTIRELY through _chatEpicById (see
            // GetEpicForChat / GetEpicByGithubNumber): every resolution path ends
            // at "is this github_number a known epic?". board.Epics comes straight
            // from bt_epics, which is only ever repopulated by a full GitHub sync —
            // so a real, open epic that hasn't been synced into bt_epics yet is
            // invisible here, and every chat linked to it (via bt_chat_issues)
            // strands permanently under "Unlinked" with no UI escape: re-assigning
            // it just rewrites the same unresolvable bt_chat_issues row, and the
            // assign path (LinkChatToIssueAsync) likewise can't set epic_id for an
            // epic bt_epics doesn't contain. Prior fixes (0709f43c) made
            // GetEpicForChat's *resolution* smarter but couldn't help, because the
            // missing record is the EPIC, not the chat. Fix: backfill _chatEpicById
            // from the live Git Board's own epics (_lastBoardIssues — already
            // fetched for the board, OPEN-only per #839) for any epic github_number
            // bt_epics doesn't already carry. The synthetic Id is negative so it
            // can never collide with a real bt_epics sequence id, and it's only ever
            // read for grouping/labelling/navigation — never fed back into a DB
            // epic-id write (every assign path links by github NUMBER, not this Id).
            // Fail-open: if the board hasn't loaded (_lastBoardIssues empty) this
            // adds nothing and behaviour is exactly as before. (Extracted to
            // BackfillSyntheticEpicsFromBoard for #1629, so the board-refresh path
            // can re-run it the moment fresh GitHub data lands mid-session.)
            BackfillSyntheticEpicsFromBoard();

            // Focus Mode needs chats + epic→issue-number to resolve a chat's milestone.
            BuildConsole.Services.FocusModeService.Instance.UpdateChatSnapshot(board.Chats, _chatEpicById);
            _chatsIsStale = isStale;
            _chatsCachedAtUtc = cachedAtUtc;

            // Git #931 — the stale/offline state itself is part of what's
            // "changed" for repaint purposes: going stale->live (or the
            // reverse) should always repaint even if the underlying board
            // data happens to be byte-identical to what's already shown.
            // Git #1629 (root cause 3) — the resolvable-epic key set is folded in
            // too: the raw DB payload is byte-identical between two polls every
            // time Shane re-clicks "assign" on an already-linked chat (ON CONFLICT
            // DO NOTHING changes nothing), yet the #1362 synthetic backfill above
            // may have JUST resolved a previously-stranded chat — a change in
            // resolvable epics must force a repaint even when the DB rows didn't move.
            var epicKeySignature = string.Join(",", _chatEpicById.Keys.OrderBy(k => k));
            var signature = isStale + "|" + epicKeySignature + "|" + System.Text.Json.JsonSerializer.Serialize(board);
            if (!forceFresh && signature == _lastBoardSignature) return;
            _lastBoardSignature = signature;

            RenderChatsTree();
        }

        /// <summary>Git #1362 (extracted for #1629) — backfills <see cref="_chatEpicById"/>
        /// from the live Git Board's own epics (<see cref="_lastBoardIssues"/>, OPEN-only per
        /// #839) for any epic github_number the local bt_epics table doesn't carry, so chats
        /// linked to a not-yet-synced epic group correctly instead of stranding under
        /// "Unlinked". The synthetic Id is negative so it can never collide with a real
        /// bt_epics sequence id, and it's only ever read for grouping/labelling/navigation —
        /// never fed back into a DB epic-id write (every assign path links by github NUMBER).
        /// Fail-open: with no live board data this adds nothing. Returns the count synthesized.</summary>
        private int BackfillSyntheticEpicsFromBoard()
        {
            if (_lastBoardIssues.Count == 0) return 0;

            var knownEpicGithubNumbers = new HashSet<int>(
                _chatEpicById.Values.Where(e => e.GithubNumber.HasValue).Select(e => e.GithubNumber!.Value));
            int synthesizedEpics = 0;
            foreach (var bi in _lastBoardIssues.Where(i => i.IsEpic && !i.IsClosed))
            {
                if (!knownEpicGithubNumbers.Add(bi.Number)) continue; // already have this epic (real or synthesized)
                _chatEpicById[-bi.Number] = new BoardEpic
                {
                    Id = -bi.Number,
                    Title = bi.Title,
                    Status = "open",
                    GithubNumber = bi.Number,
                };
                synthesizedEpics++;
            }
            if (synthesizedEpics > 0)
                ActivityLog.Log("git-board.chats",
                    $"backfilled {synthesizedEpics} live-board epic(s) missing from local bt_epics so their chats group correctly instead of stranding under Unlinked (Git #1362)");
            return synthesizedEpics;
        }

        /// <summary>Git #2068 — the write-side counterpart to <see cref="BackfillSyntheticEpicsFromBoard"/>:
        /// resolves a real GitHub issue/epic number against the SAME already-fetched
        /// <see cref="_lastBoardIssues"/> the display side reads, so
        /// <see cref="BuildQueuePostgresClient.LinkChatToIssueAsync"/>/<c>UnlinkChatFromIssueAsync</c>
        /// can self-heal a target that hasn't been GitHub-synced into bt_epics/bt_issues yet
        /// instead of silently dropping the link. Passed down as a delegate rather than exposing
        /// <c>_lastBoardIssues</c> itself, so the DB client (Services layer) never needs a
        /// reference back into this Controls-layer state. Returns null for any number not on
        /// the current OPEN board fetch — including a real GitHub Milestone number (a different
        /// number namespace _lastBoardIssues never represents), which is intentional: a
        /// milestone-only "Assign Chat to Milestone" link is correctly persisted through
        /// bt_chat_issues alone and was never meant to resolve to a local epic/issue row.</summary>
        public LiveBoardIssueInfo? ResolveLiveBoardIssue(int githubNumber)
        {
            var it = _lastBoardIssues.FirstOrDefault(i => i.Number == githubNumber);
            return it == null ? null : new LiveBoardIssueInfo(it.IsEpic, it.Title, it.ParentNumber);
        }

        /// <summary>Chats redesign — the connection/error placeholder path. Kept
        /// separate from <see cref="RenderChatsTree"/> (which renders real board
        /// data) so both share the tree-clearing + title-block reset discipline,
        /// and so the signature is nulled to force a real repaint once the board
        /// is reachable again.</summary>
        private void ShowChatsMessage(string message)
        {
            if (ChatsHost == null) return;
            ChatsHost.Children.Clear();
            ChatsHost.Children.Add(new TextBlock
            {
                Text = message,
                Foreground = GetBrush("Subtext1Brush"),
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(6, 8, 6, 0)
            });
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
        /// <summary>Git #1450: the real-GitHub-closed signal shared by the closed-epic
        /// filter (#839), the closed-chat filter, and the closed-build-badge filter
        /// below — the board's own OPEN-only issue numbers from the last successful
        /// fetch (<see cref="_lastBoardIssues"/>), or null when no live board data has
        /// loaded yet. Fail-open: every caller must hide nothing when this is null.</summary>
        private HashSet<int>? ComputeOpenGithubNumbersOrNull() =>
            _lastBoardIssues.Count > 0
                ? new HashSet<int>(_lastBoardIssues.Where(i => !i.IsClosed).Select(i => i.Number))
                : null;

        /// <summary>Git #1450: true only when the board has loaded (<paramref
        /// name="openGithubNumbers"/> non-null), the issue number is actually known to
        /// the board, AND it isn't in the open set — i.e. CONFIRMED closed on real
        /// GitHub state. A number the board has never seen fails open (returns false)
        /// rather than being assumed closed.</summary>
        private bool IsIssueConfirmedClosed(int issueNumber, HashSet<int>? openGithubNumbers) =>
            openGithubNumbers != null
            && _lastBoardIssues.Any(i => i.Number == issueNumber)
            && !openGithubNumbers.Contains(issueNumber);

        /// <summary>Git #1450 — extends the closed-epic filter (#839) down to the
        /// individual chat: true only when EVERY GitHub issue number linked to this
        /// chat (its own <see cref="BoardChat.AssociatedIssueNumbers"/>, plus any
        /// linked build's own issue number) is <see cref="IsIssueConfirmedClosed"/>. A
        /// chat with no linked issue numbers at all is never considered closed by this
        /// filter.</summary>
        private bool AreAllLinkedIssuesClosed(BoardChat chat, IReadOnlyList<QueueItem> queueItems, HashSet<int>? openGithubNumbers)
        {
            var linkedNumbers = chat.AssociatedIssueNumbers
                .Concat(queueItems
                    .Where(qi => (qi.OriginatingChatId != null && string.Equals(qi.OriginatingChatId, chat.ConversationId, StringComparison.OrdinalIgnoreCase))
                              || (qi.GithubNumber.HasValue && chat.AssociatedIssueNumbers.Contains(qi.GithubNumber.Value)))
                    .Where(qi => qi.GithubNumber.HasValue)
                    .Select(qi => qi.GithubNumber!.Value))
                .Distinct()
                .ToList();

            if (linkedNumbers.Count == 0) return false;
            return linkedNumbers.All(n => IsIssueConfirmedClosed(n, openGithubNumbers));
        }

        private void RenderChatsTree()
        {
            if (ChatsHost == null) return;

            // Card list is rebuilt on every render. Keep the (hidden) legacy tree empty.
            ChatsHost.Children.Clear();
            if (ChatsTree != null) ChatsTree.Items.Clear();

            string search = (ChatSearch?.Text ?? "").Trim();
            bool searching = search.Length > 0;

            if (_chatsIsStale)
            {
                ChatsHost.Children.Add(new Border
                {
                    Background = new SolidColorBrush(Color.FromArgb(0x22, 0xFA, 0xB3, 0x87)),
                    CornerRadius = new CornerRadius(6),
                    Padding = new Thickness(8, 5, 8, 5),
                    Margin = new Thickness(0, 0, 0, 6),
                    Child = new TextBlock
                    {
                        Text = $"⚠ Offline — cached chats from {_chatsCachedAtUtc?.ToLocalTime():MMM d, h:mm tt}",
                        Foreground = GetBrush("PeachBrush"),
                        FontSize = 11,
                        TextWrapping = TextWrapping.Wrap,
                    }
                });
            }

            var epicById = _chatEpicById;
            // Git: Chats panel Archive — a soft-hidden chat (and all its real
            // associations) stays fully intact server-side; the toggle just
            // decides which slice of _lastBoardChats this render shows. Off
            // (default): archived chats drop out entirely, same as today.
            // On: ONLY archived chats show, so Shane can find and unarchive one.
            bool showArchivedOnly = ChatShowArchived?.IsChecked == true;

            // Closed-issue/build filtering (Git #1450) and closed-epic filtering below both
            // need the SAME live open-issue signal, so it's computed once, up front, and
            // reused by both. Fail-open per #839: null means the board hasn't loaded yet,
            // and every consumer below must hide nothing when it's null.
            var openGithubNumbers = ComputeOpenGithubNumbersOrNull();
            var queueItemsForClosure = GetQueueItems?.Invoke() ?? Array.Empty<QueueItem>();

            // Git #1450 — extends the closed-epic pattern down to the individual chat: a
            // chat drops out of the Chats panel entirely once EVERY GitHub issue number
            // linked to it (directly, or via one of its linked builds) is CONFIRMED closed
            // on the real board. A chat with no linked issue numbers, or with at least one
            // number whose closed state isn't confirmed yet, is never hidden by this filter.
            int hiddenClosedChats1450 = 0;

            // Git #1480 — the title-bar Primary/Secondary toggle scopes the Chats panel to
            // whichever account is currently selected. Composes with every filter above/below
            // (focus mode, archived, #1450 closed-issue) rather than replacing any of them.
            string currentAccount = BuildConsole.Services.BuildConsoleSettings.CurrentAccountLabel();
            string otherAccount = string.Equals(currentAccount, "secondary", StringComparison.OrdinalIgnoreCase) ? "primary" : "secondary";

            // Cross-account badge (#1480, requirement 5) — computed from the FULL unfiltered
            // (minus archived) board, not the account-scoped list below, so Shane sees the other
            // account's real in-progress count regardless of focus-mode/closed-issue filtering.
            int otherAccountInProgress = _lastBoardChats
                .Where(c => !c.Archived)
                .Where(c => string.Equals(c.Account, otherAccount, StringComparison.OrdinalIgnoreCase))
                .Count(c => BuildConsole.Services.FocusModeService.Instance.IsChatInProgressForAccount(c.ConversationId, otherAccount));

            // Git #2534 — Milestone→Epic→Chat mode. When a real Focus milestone is active
            // and we have live board data, the panel is scoped to that milestone and lists
            // EVERY open epic in it (even zero-chat ones, so each has a "New Chat" affordance),
            // grouping each epic's chats under it via bt_chats.epic_id (GetEpicForChat's first
            // resolution path). The per-epic scoping IS the milestone scoping, so the older
            // per-chat IsChatInFocus predicate is skipped here (it resolves the same milestone
            // less directly). With no active milestone, the legacy chat-derived grouping below
            // is used unchanged.
            // Gate on IsActive (focus genuinely engaged AND a milestone set), not just a
            // last-focused milestone lingering after Deactivate — so toggling Focus off restores
            // the legacy all-chats grouping exactly as before, and only an engaged Focus session
            // gets the milestone-scoped structure.
            var focusSvc = BuildConsole.Services.FocusModeService.Instance;
            int? activeMilestone = focusSvc.ActiveMilestoneNumber;
            bool milestoneMode = focusSvc.IsActive && activeMilestone.HasValue && _lastBoardIssues.Count > 0;

            // Focus Mode — hard-hide chats that don't belong to the active milestone
            // (resolved via the chat's issue / epic issue number). Off-focus = all chats.
            var focusChats = _lastBoardChats
                .Where(c => string.Equals(c.Account, currentAccount, StringComparison.OrdinalIgnoreCase))
                .Where(c => milestoneMode || BuildConsole.Services.FocusModeService.Instance.IsChatInFocus(c))
                .Where(c => showArchivedOnly ? c.Archived : !c.Archived)
                .Where(c =>
                {
                    bool closed = AreAllLinkedIssuesClosed(c, queueItemsForClosure, openGithubNumbers);
                    if (closed) hiddenClosedChats1450++;
                    return !closed;
                })
                .ToList();
            if (hiddenClosedChats1450 > 0)
                ActivityLog.Log("git-board.chats",
                    $"closed-issue filter hid {hiddenClosedChats1450} chat(s) whose linked GitHub issue(s) are all confirmed closed (#1450, extends #839 convention)");

            var chatsWithEpic = focusChats.Select(c => new { Chat = c, Epic = GetEpicForChat(c) }).ToList();
            var byEpic = chatsWithEpic.Where(x => x.Epic != null).GroupBy(x => x.Epic!.Id, x => x.Chat);
            var unlinked = chatsWithEpic.Where(x => x.Epic == null).Select(x => x.Chat).ToList();


            // Closed-epic filtering — mirror the Git Board's #839 convention
            // ("done done get out of my view": closed items drop out of the
            // default view) for the Chats panel too. A chat whose linked epic
            // has closed on GitHub used to linger here (Shane's example: the
            // closed EPIC "Copilot Readiness Scroll…"). Two independent, both
            // reliable, signals decide "closed" — an epic group matching EITHER
            // is hidden entirely, its nested chats along with it:
            //
            //   (A) The chat's EpicId isn't in _chatEpicById at all. The server's
            //       GET /extension/board already filters `epics` to the OPEN set
            //       (bt_epics.status != "closed"), so an EpicId that resolves to
            //       no returned epic means the server considers that epic closed.
            //       (These used to render as an orphan "Epic #<id>" fallback row.)
            //
            //   (B) The epic IS returned by the server (its LOCAL status still
            //       reads open), but the SAME real GitHub state the Git Board
            //       itself fetched (_lastBoardIssues, OPEN-only, per #839) shows
            //       its GitHub issue is no longer open — i.e. the local bt_epics
            //       row is lagging real GitHub state. This is the case that let
            //       #343 leak through the server filter.
            //
            // Fail-open: signal (B) is only applied when we actually HAVE live
            // board data (_lastBoardIssues non-empty — the board has loaded, a
            // PAT is set, the fetch succeeded). With no live data we know nothing
            // and hide nothing, so a chat is never wrongly removed for lack of
            // knowledge; the next poll (once the board loads) removes it then.
            bool IsEpicClosed(int epicId)
            {
                if (!epicById.TryGetValue(epicId, out var ep)) return true;               // (A)
                return openGithubNumbers != null
                    && ep.GithubNumber.HasValue
                    && !openGithubNumbers.Contains(ep.GithubNumber.Value);                // (B)
            }

            int hiddenClosedEpics = 0, hiddenClosedChats = 0;

            // Build (title, chats) groups.
            var groups = new List<(string Title, int? GithubNumber, List<BoardChat> Chats)>();
            if (milestoneMode)
            {
                // Git #2534 — list EVERY open epic in the active milestone from the live board
                // (_lastBoardIssues, OPEN-only), then hang each epic's real chats under it,
                // matched by the epic's GitHub number against each chat's resolved epic_id.
                // A zero-chat epic still gets a group (its section renders a "New Chat" button).
                var chatsByEpicGithub = chatsWithEpic
                    .Where(x => x.Epic?.GithubNumber != null)
                    .GroupBy(x => x.Epic!.GithubNumber!.Value)
                    .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Chat.UpdatedAt).Select(x => x.Chat).ToList());

                var milestoneEpics = _lastBoardIssues
                    .Where(i => i.IsEpic && !i.IsClosed && i.MilestoneNumber == activeMilestone!.Value)
                    .GroupBy(i => i.Number).Select(g => g.First())
                    .ToList();

                foreach (var epic in milestoneEpics)
                {
                    var epicChats = chatsByEpicGithub.TryGetValue(epic.Number, out var cs) ? cs : new List<BoardChat>();
                    groups.Add((epic.Title, epic.Number, epicChats));
                }
                // Most-recently-active epics first; zero-chat epics fall to the bottom (by title).
                groups.Sort((a, b) =>
                {
                    DateTime? la = a.Chats.Count > 0 ? a.Chats.Max(c => c.UpdatedAt) : null;
                    DateTime? lb = b.Chats.Count > 0 ? b.Chats.Max(c => c.UpdatedAt) : null;
                    if (la.HasValue && lb.HasValue) return Nullable.Compare(lb, la);
                    if (la.HasValue) return -1;
                    if (lb.HasValue) return 1;
                    return string.Compare(a.Title, b.Title, StringComparison.OrdinalIgnoreCase);
                });
                ActivityLog.Log("git-board.chats",
                    $"milestone→epic→chat: milestone #{activeMilestone!.Value} — {milestoneEpics.Count} open epic(s), {chatsByEpicGithub.Values.Sum(v => v.Count)} chat(s) grouped by epic_id (Git #2534)");
            }
            else
            {
                // Legacy (no active milestone): real epics that HAVE chats, sorted alphabetically
                // (a stable top-level index, exactly like #984's alphabetical areas), with
                // "Unlinked" pinned last as the no-category bucket. Closed epics drop out (#839).
                foreach (var grp in byEpic)
                {
                    var chatsInGroup = grp.OrderByDescending(c => c.UpdatedAt).ToList();
                    if (IsEpicClosed(grp.Key))
                    {
                        hiddenClosedEpics++;
                        hiddenClosedChats += chatsInGroup.Count;
                        continue;
                    }
                    epicById.TryGetValue(grp.Key, out var epic);
                    var title = epic != null ? epic.Title : $"Epic #{grp.Key}";
                    groups.Add((title, epic?.GithubNumber, chatsInGroup));
                }
                if (hiddenClosedEpics > 0)
                    ActivityLog.Log("git-board.chats",
                        $"closed-epic filter hid {hiddenClosedEpics} closed epic(s) and their {hiddenClosedChats} nested chat(s) from the Chats panel (#839 convention)");
                groups.Sort((a, b) => string.Compare(a.Title, b.Title, StringComparison.OrdinalIgnoreCase));
                if (unlinked.Count > 0)
                    groups.Add(("Unlinked", null, unlinked.OrderByDescending(c => c.UpdatedAt).ToList()));
            }

            // Apply the search filter per group, keeping only groups with visible chats,
            // and tally the global "in progress / waiting on you" counts for the summary strip.
            var visibleGroups = new List<(string Title, int? GithubNumber, List<BoardChat> Chats)>();
            int shown = 0, totalInProgress = 0, totalWaiting = 0;
            foreach (var (title, githubNumber, chats) in groups)
            {
                bool epicMatches = searching && title.Contains(search, StringComparison.OrdinalIgnoreCase);
                var leaves = chats
                    .Where(c => !searching || epicMatches
                                || (c.Title ?? "").Contains(search, StringComparison.OrdinalIgnoreCase))
                    .ToList();
                // Git #2534 — in milestone mode a zero-chat epic still renders (so its "New Chat"
                // button is reachable): keep it unless a search is active that it doesn't match.
                if (leaves.Count == 0 && !(milestoneMode && (!searching || epicMatches))) continue;
                visibleGroups.Add((title, githubNumber, leaves));
                shown += leaves.Count;
                var s = GroupBuildStats(leaves);
                totalInProgress += s.inProgress;
                totalWaiting += s.waiting;
            }

            // Top summary strip — the at-a-glance "what am I working on" answer. Shown whenever
            // there's something to say: real chats under the current account, OR (#1480) the
            // other account has in-progress work parked even if the current one is empty.
            if (shown > 0 || otherAccountInProgress > 0)
                ChatsHost.Children.Add(BuildChatsSummaryStrip(shown, visibleGroups.Count, totalInProgress, totalWaiting, otherAccountInProgress, otherAccount));

            // One collapsible card section per epic group (colour-coded, same stable-hash
            // convention #984's areas use so an epic keeps its colour session to session).
            foreach (var (title, githubNumber, chats) in visibleGroups)
            {
                string brushKey = AreaBrushKey(title);
                ChatsHost.Children.Add(BuildEpicSection(title, githubNumber, chats, brushKey, forceExpanded: searching, openGithubNumbers));
            }

            // Git #2534 — in milestone mode a section list with only zero-chat epics is NOT the
            // "no chats" empty state (each epic is actionable via its New Chat button), so key
            // the placeholder off whether any section rendered at all, not the chat count.
            bool empty = visibleGroups.Count == 0;
            if (TxtNoChats != null)
            {
                TxtNoChats.Visibility = empty && !_chatsIsStale ? Visibility.Visible : Visibility.Collapsed;
                TxtNoChats.Text = searching && empty
                    ? $"No chats match \"{search}\"."
                    : showArchivedOnly
                        ? "No archived chats."
                        : "No chats linked yet.";
            }
        }

        /// <summary>Chats redesign (mirrors #984's MakeAreaHeader) — a colour-coded
        /// epic row: an 8×8 rounded colour chip, the epic title in that epic's accent
        /// colour, and a muted chat-count badge (e.g. "War Room  (6)"). The title is
        /// registered for #932's explicit-MaxWidth trimming.</summary>
        /// <summary>Remembered expand/collapse state for epic sections in the Chats card list.</summary>
        private readonly HashSet<string> _expandedEpicKeys = new();

        /// <summary>
        /// Chats redesign (Build-Queue-style cards) — one epic SECTION: a clickable header
        /// card (colour chip, title, #issue, chat count, an epic progress bar over its
        /// sub-issues, and in-progress / running / waiting counters + last-active time) with
        /// a collapsible body of per-chat cards. Collapsed by default; a search force-expands
        /// matching sections; expansion state is remembered in <see cref="_expandedEpicKeys"/>.
        /// </summary>
        private FrameworkElement BuildEpicSection(string title, int? githubNumber, List<BoardChat> chats, string brushKey, bool forceExpanded, HashSet<int>? openGithubNumbers)
        {
            var accent = GetBrush(brushKey);
            string epicKey = "epic:" + title;
            // Git #2534 — a zero-chat epic starts expanded so its "New Chat" button is visible
            // without a first click (it's the only actionable thing in the section).
            bool expanded = forceExpanded || _expandedEpicKeys.Contains(epicKey) || chats.Count == 0;

            var section = new StackPanel { Margin = new Thickness(0, 0, 0, 6) };

            var header = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Cursor = System.Windows.Input.Cursors.Hand,
            };
            var hStack = new StackPanel();

            var topRow = new DockPanel();
            var chevron = new TextBlock { Text = expanded ? "▾" : "▸", FontSize = 10, Foreground = GetBrush("Subtext0Brush"), Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center };
            DockPanel.SetDock(chevron, Dock.Left);
            topRow.Children.Add(chevron);
            var chip = new Border { Width = 9, Height = 9, CornerRadius = new CornerRadius(2), Background = accent, Margin = new Thickness(0, 0, 7, 0), VerticalAlignment = VerticalAlignment.Center };
            DockPanel.SetDock(chip, Dock.Left);
            topRow.Children.Add(chip);
            var countBadge = new TextBlock { Text = chats.Count.ToString(), FontSize = 10.5, Foreground = GetBrush("Subtext0Brush"), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(6, 0, 0, 0), ToolTip = $"{chats.Count} chat(s)" };
            DockPanel.SetDock(countBadge, Dock.Right);
            topRow.Children.Add(countBadge);
            // Git #2534 — green-tinted "<N> open" pill: the epic's real count of still-open
            // sub-issues on the live board (design-reference right-aligned badge).
            if (githubNumber.HasValue)
            {
                int openIssues = _lastBoardIssues.Count(i => i.ParentNumber == githubNumber.Value && !i.IsClosed);
                var openPill = new Border
                {
                    Background = new SolidColorBrush(Color.FromArgb(0x22, 0xA6, 0xE3, 0xA1)),
                    CornerRadius = new CornerRadius(8),
                    Padding = new Thickness(6, 0, 6, 0),
                    Margin = new Thickness(6, 0, 0, 0),
                    VerticalAlignment = VerticalAlignment.Center,
                    ToolTip = $"{openIssues} open sub-issue(s) under this epic",
                    Child = new TextBlock { Text = $"{openIssues} open", FontSize = 10, Foreground = GetBrush("GreenBrush"), VerticalAlignment = VerticalAlignment.Center },
                };
                DockPanel.SetDock(openPill, Dock.Right);
                topRow.Children.Add(openPill);
            }
            if (githubNumber.HasValue)
            {
                var numTb = new TextBlock { Text = $"#{githubNumber.Value}", FontSize = 10.5, Foreground = GetBrush("Subtext0Brush"), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(6, 0, 0, 0) };
                DockPanel.SetDock(numTb, Dock.Right);
                topRow.Children.Add(numTb);
            }
            var titleTb = new TextBlock { Text = title, FontSize = 13, FontWeight = FontWeights.SemiBold, Foreground = accent, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
            topRow.Children.Add(titleTb); // last child fills remaining width
            hStack.Children.Add(topRow);

            // Epic progress bar over its real sub-issues.
            var (done, total) = EpicProgress(githubNumber);
            if (total > 0)
            {
                double frac = Math.Max(0.0, Math.Min(1.0, (double)done / total));
                var fillGrid = new Grid();
                fillGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(frac, GridUnitType.Star) });
                fillGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1 - frac, GridUnitType.Star) });
                var fill = new Border { CornerRadius = new CornerRadius(3), Background = accent };
                Grid.SetColumn(fill, 0);
                fillGrid.Children.Add(fill);
                hStack.Children.Add(new Border { Height = 5, CornerRadius = new CornerRadius(3), Background = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)), Margin = new Thickness(0, 6, 0, 0), Child = fillGrid });
                hStack.Children.Add(new TextBlock { Text = $"{done}/{total} issues done", FontSize = 9.5, Foreground = GetBrush("Subtext0Brush"), Margin = new Thickness(0, 2, 0, 0) });
            }

            // Status counters + last-active. (chats may be empty in milestone mode — guard Max.)
            var stats = GroupBuildStats(chats);
            DateTime? lastActive = chats.Count > 0 ? chats.Max(c => c.UpdatedAt) : null;
            var counters = new WrapPanel { Margin = new Thickness(0, 5, 0, 0) };
            void AddCounter(string text, string bk, string tip) => counters.Children.Add(new TextBlock { Text = text, FontSize = 10, Foreground = GetBrush(bk), Margin = new Thickness(0, 0, 10, 0), VerticalAlignment = VerticalAlignment.Center, ToolTip = tip });
            if (stats.inProgress > 0) AddCounter($"⚡ {stats.inProgress} in progress", "YellowBrush", $"{stats.inProgress} chat(s) marked In Progress");
            if (stats.running > 0) AddCounter($"▶ {stats.running} running", "BlueBrush", $"{stats.running} linked build(s) running");
            if (stats.waiting > 0) AddCounter($"⏳ {stats.waiting} waiting", "PeachBrush", $"{stats.waiting} item(s) need you (failed/blocked builds or Shane To-Do issues)");
            if (lastActive.HasValue) AddCounter($"🕒 {RelativeTime(lastActive)}", "Subtext0Brush", (lastActive.Value.Kind == DateTimeKind.Utc ? lastActive.Value.ToLocalTime() : lastActive.Value).ToString("f"));
            if (counters.Children.Count > 0) hStack.Children.Add(counters);

            header.Child = hStack;

            var body = new StackPanel { Margin = new Thickness(2, 5, 0, 0), Visibility = expanded ? Visibility.Visible : Visibility.Collapsed };
            foreach (var chat in chats) body.Children.Add(BuildChatCard(chat, brushKey, openGithubNumbers));

            // Git #2534 — every real epic section gets a "New Chat" affordance (req 4/5): a
            // zero-chat epic reads "+ New Chat", one with chats reads "+ Continue in a new chat".
            // Both start a new chat pre-associated to THIS epic (epic_id set on create by the
            // same LinkChatToIssueAsync write path via AssociateChatWithIssueAsync).
            if (githubNumber.HasValue)
            {
                string newChatLabel = chats.Count == 0 ? "+ New Chat" : "+ Continue in a new chat";
                var newChatBtn = new Border
                {
                    Background = GetBrush("MantleBrush"),
                    BorderBrush = accent,
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(5),
                    Padding = new Thickness(8, 5, 8, 5),
                    Margin = new Thickness(0, 2, 0, 4),
                    Cursor = System.Windows.Input.Cursors.Hand,
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    ToolTip = $"Start a new chat pre-associated to #{githubNumber.Value} — {title}",
                    Child = new TextBlock { Text = newChatLabel, FontSize = 11.5, Foreground = accent, HorizontalAlignment = HorizontalAlignment.Center, FontWeight = FontWeights.SemiBold },
                };
                int capturedNumber = githubNumber.Value;
                string capturedTitle = title;
                newChatBtn.MouseLeftButtonUp += (s, e) => { e.Handled = true; StartNewEpicChat(capturedNumber, capturedTitle); };
                body.Children.Add(newChatBtn);
            }

            header.MouseLeftButtonUp += (s, e) =>
            {
                bool nowExpanded = body.Visibility != Visibility.Visible;
                body.Visibility = nowExpanded ? Visibility.Visible : Visibility.Collapsed;
                chevron.Text = nowExpanded ? "▾" : "▸";
                if (nowExpanded) _expandedEpicKeys.Add(epicKey); else _expandedEpicKeys.Remove(epicKey);
            };

            section.Children.Add(header);
            section.Children.Add(body);
            return section;
        }

        /// <summary>Top-of-panel at-a-glance strip: total chats, in-progress, waiting-on-you.</summary>
        /// <summary>Top-of-panel at-a-glance strip: total chats, in-progress, waiting-on-you,
        /// plus (#1480) a count-only badge for the OTHER account's in-progress chats — never
        /// listed here, just a number, so Shane can see there's work parked over there without
        /// this panel actually showing it. Clicking it does nothing in v1 (per #1480 spec).</summary>
        private Border BuildChatsSummaryStrip(int chatCount, int groupCount, int inProgress, int waiting, int otherAccountInProgress = 0, string? otherAccountLabel = null)
        {
            var sp = new WrapPanel { Orientation = Orientation.Horizontal };
            void AddStat(string text, string bk, string tip) => sp.Children.Add(new TextBlock { Text = text, FontSize = 11, Foreground = GetBrush(bk), Margin = new Thickness(0, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center, ToolTip = tip });
            AddStat($"{chatCount} chats", "Subtext1Brush", $"{chatCount} chat(s) across {groupCount} group(s)");
            if (inProgress > 0) AddStat($"⚡ {inProgress} in progress", "YellowBrush", $"{inProgress} chat(s) marked In Progress");
            if (waiting > 0) AddStat($"⏳ {waiting} waiting on you", "PeachBrush", $"{waiting} item(s) need your attention");
            if (otherAccountInProgress > 0 && !string.IsNullOrEmpty(otherAccountLabel))
            {
                string otherLabelTitleCase = char.ToUpperInvariant(otherAccountLabel[0]) + otherAccountLabel.Substring(1);
                AddStat($"{otherAccountInProgress} in progress on {otherLabelTitleCase}", "Subtext0Brush",
                    $"{otherAccountInProgress} chat(s) marked In Progress on the {otherLabelTitleCase} account — switch the title-bar toggle to see them");
            }
            return new Border
            {
                Background = GetBrush("MantleBrush"),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 5, 8, 5),
                Margin = new Thickness(0, 0, 0, 6),
                Child = sp
            };
        }

        /// <summary>Linked-build + in-progress counts for a group of chats.</summary>
        private (int inProgress, int running, int waiting) GroupBuildStats(List<BoardChat> chats)
        {
            int inProgress = chats.Count(c => BuildConsole.Services.FocusModeService.Instance.IsChatInProgressForAccount(c.ConversationId, BuildConsole.Services.BuildConsoleSettings.CurrentAccountLabel()));
            var builds = ChatLinkedBuilds(chats);
            int running = builds.Count(b => string.Equals(b.Status, "running", StringComparison.OrdinalIgnoreCase));
            int waiting = builds.Count(b => { var s = (b.Status ?? "").ToLowerInvariant(); return s == "failed" || s == "error" || s == "blocked"; });
            var issueNums = new HashSet<int>(chats.SelectMany(c => c.AssociatedIssueNumbers));
            waiting += _lastBoardIssues.Count(i => i.IsTodo && issueNums.Contains(i.Number));
            return (inProgress, running, waiting);
        }

        /// <summary>Every queued/running/finished build linked to any of these chats (by originating chat or linked issue number).</summary>
        private List<QueueItem> ChatLinkedBuilds(IEnumerable<BoardChat> chats)
        {
            var items = GetQueueItems?.Invoke() ?? Array.Empty<QueueItem>();
            var chatIds = new HashSet<string>(chats.Select(c => c.ConversationId), StringComparer.OrdinalIgnoreCase);
            var issueNums = new HashSet<int>(chats.SelectMany(c => c.AssociatedIssueNumbers));
            return items.Where(it =>
                (it.OriginatingChatId != null && chatIds.Contains(it.OriginatingChatId))
                || (it.GithubNumber.HasValue && issueNums.Contains(it.GithubNumber.Value))).ToList();
        }

        /// <summary>Epic progress from its real sub-issues: (done, total). Total is the epic issue's
        /// GraphQL SubIssueCount; done = total minus the sub-issues still OPEN in the board (the board
        /// is OPEN-only). Falls back to counting cached children by ParentNumber. (0,0) hides the bar.</summary>
        private (int done, int total) EpicProgress(int? epicGithubNumber)
        {
            if (!epicGithubNumber.HasValue) return (0, 0);
            int epicNum = epicGithubNumber.Value;
            var epicIssue = _lastBoardIssues.FirstOrDefault(i => i.Number == epicNum);
            int total = epicIssue?.SubIssueCount ?? 0;
            if (total > 0)
            {
                int openKids = _lastBoardIssues.Count(i => i.ParentNumber == epicNum && !i.IsClosed);
                return (Math.Max(0, total - openKids), total);
            }
            var kids = _lastBoardIssues.Where(i => i.ParentNumber == epicNum).ToList();
            if (kids.Count == 0) return (0, 0);
            return (kids.Count(k => k.IsClosed), kids.Count);
        }

        /// <summary>Human "2h ago" style relative time for a chat's last-updated stamp.</summary>
        private static string RelativeTime(DateTime? stamp)
        {
            if (!stamp.HasValue) return "";
            var when = stamp.Value;
            var now = when.Kind == DateTimeKind.Utc ? DateTime.UtcNow : DateTime.Now;
            var span = now - when;
            if (span.TotalSeconds < 45) return "just now";
            if (span.TotalMinutes < 60) return $"{Math.Max(1, (int)span.TotalMinutes)}m ago";
            if (span.TotalHours < 24) return $"{(int)span.TotalHours}h ago";
            if (span.TotalDays < 7) return $"{(int)span.TotalDays}d ago";
            return (when.Kind == DateTimeKind.Utc ? when.ToLocalTime() : when).ToString("MMM d");
        }

        /// <summary>Finds a cached BoardChat by its ConversationId (used by Focus mode in-progress switchers).</summary>
        public BoardChat? FindChatByConversationId(string conversationId)
        {
            if (string.IsNullOrWhiteSpace(conversationId)) return null;
            return _lastBoardChats.FirstOrDefault(c => string.Equals(c.ConversationId, conversationId, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>Chats redesign (mirrors #984's MakeLeafHeader) — a chat leaf with a
        /// thin epic-coloured left bar + the chat title in muted Subtext1Brush. Title
        /// registered for #932's MaxWidth trim. Retains #828's "Assign to Epic..."
        /// right-click, now sourcing its epic list from the cached <see cref="_chatEpicById"/>
        /// instead of the fetch's board.Epics (identical data, no second round-trip).</summary>
        private Border BuildChatCard(BoardChat chat, string brushKey, HashSet<int>? openGithubNumbers)
        {
            bool inProgress = BuildConsole.Services.FocusModeService.Instance.IsChatInProgressForAccount(chat.ConversationId, BuildConsole.Services.BuildConsoleSettings.CurrentAccountLabel());
            var accent = GetBrush(brushKey);

            // Card shell (a highlighted border when marked In Progress).
            var card = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = inProgress ? GetBrush("YellowBrush") : GetBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5),
                Margin = new Thickness(0, 0, 0, 4),
                Tag = chat,
                Cursor = System.Windows.Input.Cursors.Hand,
            };

            var outer = new DockPanel { LastChildFill = true };
            var bar = new Border { Width = 3, Background = accent, CornerRadius = new CornerRadius(5, 0, 0, 5) };
            DockPanel.SetDock(bar, Dock.Left);
            outer.Children.Add(bar);

            var content = new StackPanel { Margin = new Thickness(7, 5, 7, 5) };

            // Row 1: [icons] [title *] [relative time] — the star column + trimming keep it
            // inside the panel width (the old tree's overflow is gone by construction).
            var titleRow = new Grid();
            titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var icons = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            if (inProgress)
                icons.Children.Add(new TextBlock { Text = "⚡", FontSize = 11, Foreground = GetBrush("YellowBrush"), Margin = new Thickness(0, 0, 4, 0), VerticalAlignment = VerticalAlignment.Center, ToolTip = "Marked as In Progress (quickly accessible in Focus mode)" });
            if (chat.Archived)
                icons.Children.Add(new TextBlock { Text = "🗄", FontSize = 11, Foreground = GetBrush("Subtext0Brush"), Margin = new Thickness(0, 0, 4, 0), VerticalAlignment = VerticalAlignment.Center, ToolTip = chat.ArchivedAt.HasValue ? $"Archived {chat.ArchivedAt.Value.ToLocalTime():MMM d, h:mm tt} — right-click to Unarchive" : "Archived — right-click to Unarchive" });
            Grid.SetColumn(icons, 0);
            titleRow.Children.Add(icons);

            var titleBlock = new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(chat.Title) ? "(untitled chat)" : chat.Title,
                FontSize = 12.5,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = chat.Archived ? GetBrush("Subtext0Brush") : (inProgress ? GetBrush("YellowBrush") : GetBrush("TextBrush")),
                FontWeight = inProgress ? FontWeights.SemiBold : FontWeights.Normal,
                TextTrimming = TextTrimming.CharacterEllipsis,
            };
            Grid.SetColumn(titleBlock, 1);
            titleRow.Children.Add(titleBlock);

            var timeBlock = new TextBlock
            {
                Text = RelativeTime(chat.UpdatedAt),
                FontSize = 9.5,
                Foreground = GetBrush("Subtext0Brush"),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(6, 0, 0, 0),
                ToolTip = chat.UpdatedAt.HasValue ? (chat.UpdatedAt.Value.Kind == DateTimeKind.Utc ? chat.UpdatedAt.Value.ToLocalTime() : chat.UpdatedAt.Value).ToString("f") : null,
            };
            Grid.SetColumn(timeBlock, 2);
            titleRow.Children.Add(timeBlock);
            content.Children.Add(titleRow);

            // Row 2: compact linked-issue pills + build-status badges, WRAPPING so they never
            // push the card past the panel edge.
            var chips = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };

            // Render nested issue pills under this chat
            if (chat.AssociatedIssueNumbers != null)
            {
                foreach (var issueNum in chat.AssociatedIssueNumbers)
                {
                    var spPill = new StackPanel { Orientation = Orientation.Horizontal };
                    string issueTitle = "";
                    string issueState = "";
                    var matchedIssue = _lastBoardIssues.FirstOrDefault(i => i.Number == issueNum);
                    if (matchedIssue != null)
                    {
                        issueTitle = matchedIssue.Title;
                        issueState = matchedIssue.State;
                    }
                    else
                    {
                        var matchedMilestone = _lastMilestoneInfos.FirstOrDefault(m => m.Number == issueNum);
                        if (matchedMilestone != null)
                        {
                            issueTitle = matchedMilestone.Title;
                            issueState = matchedMilestone.State;
                        }
                    }

                    spPill.Children.Add(new TextBlock
                    {
                        Text = $"#{issueNum}",
                        FontWeight = FontWeights.Bold,
                        Foreground = GetBrush("BlueBrush"),
                        Margin = new Thickness(0, 0, 6, 0),
                        VerticalAlignment = VerticalAlignment.Center
                    });

                    if (!string.IsNullOrEmpty(issueTitle))
                    {
                        var tbTitle = new TextBlock
                        {
                            Text = issueTitle,
                            Foreground = GetBrush("TextBrush"),
                            TextTrimming = TextTrimming.CharacterEllipsis,
                            MaxWidth = 140,
                            VerticalAlignment = VerticalAlignment.Center
                        };
                        spPill.Children.Add(tbTitle);

                        bool isClosed = string.Equals(issueState, "closed", StringComparison.OrdinalIgnoreCase);
                        var tbStatus = new TextBlock
                        {
                            Text = isClosed ? " 🟢" : " 🔴",
                            ToolTip = isClosed ? "Closed" : "Open",
                            FontSize = 10,
                            VerticalAlignment = VerticalAlignment.Center,
                            Margin = new Thickness(4, 0, 0, 0)
                        };
                        spPill.Children.Add(tbStatus);
                    }

                    var pillBorder = new Border
                    {
                        Background = GetBrush("Surface0Brush"),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(5, 1, 5, 1),
                        Margin = new Thickness(0, 0, 4, 4),
                        ToolTip = string.IsNullOrEmpty(issueTitle) ? $"Issue #{issueNum}" : $"#{issueNum} — {issueTitle} ({(string.Equals(issueState, "closed", StringComparison.OrdinalIgnoreCase) ? "Closed" : "Open")})"
                    };
                    pillBorder.Child = spPill;
                    chips.Children.Add(pillBorder);
                }
            }

            // Git #2066 — noisy "mentioned in this chat's text" pills, visually distinct
            // (muted, no title/state lookup) from the deliberate linked-issue pills above.
            // Only shows numbers not already covered by a real link, so the same issue
            // never renders twice.
            if (chat.MentionedIssueNumbers != null && chat.MentionedIssueNumbers.Count > 0)
            {
                var mentionedOnly = chat.MentionedIssueNumbers
                    .Where(n => chat.AssociatedIssueNumbers == null || !chat.AssociatedIssueNumbers.Contains(n))
                    .Distinct()
                    .OrderBy(n => n)
                    .ToList();

                foreach (var issueNum in mentionedOnly)
                {
                    var mentionBorder = new Border
                    {
                        Background = GetBrush("MantleBrush"),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(5, 1, 5, 1),
                        Margin = new Thickness(0, 0, 4, 4),
                        ToolTip = $"#{issueNum} — mentioned in this chat (auto-detected, not a deliberate link)"
                    };
                    mentionBorder.Child = new TextBlock
                    {
                        Text = $"#{issueNum}",
                        FontSize = 10.5,
                        Foreground = GetBrush("Subtext0Brush"),
                        VerticalAlignment = VerticalAlignment.Center
                    };
                    chips.Children.Add(mentionBorder);
                }
            }

            // Render nested build reports under this chat
            var queueItems = GetQueueItems?.Invoke() ?? Array.Empty<QueueItem>();
            var chatBuilds = queueItems
                .Where(item => (item.OriginatingChatId != null && string.Equals(item.OriginatingChatId, chat.ConversationId, StringComparison.OrdinalIgnoreCase))
                            || (item.GithubNumber.HasValue && (chat.AssociatedIssueNumbers?.Contains(item.GithubNumber.Value) ?? false)))
                // Git #1450: a build badge drops out once its own linked GitHub issue is
                // CONFIRMED closed on the real board — same fail-open signal as the
                // chat/epic-level filters (never hides on missing/stale board data).
                .Where(item => !(item.GithubNumber.HasValue && IsIssueConfirmedClosed(item.GithubNumber.Value, openGithubNumbers)))
                .OrderByDescending(item => item.Id)
                .ToList();

            foreach (var build in chatBuilds)
            {
                var buildSp = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 1, 0, 1) };
                
                var gitDot = new TextBlock
                {
                    Text = "● ",
                    Foreground = GetBrush("Subtext1Brush"),
                    FontWeight = FontWeights.Bold,
                    VerticalAlignment = VerticalAlignment.Center
                };
                buildSp.Children.Add(gitDot);

                string statusText = (build.Status ?? "queued").ToUpper();
                Brush statusBg = GetBrush("Surface0Brush");
                Brush statusFg = GetBrush("TextBrush");
                switch (statusText)
                {
                    case "DONE":
                        // Git #1450: "DONE" read as fully finished when it really only means
                        // "code landed, still needs Shane/chat to verify and close the GitHub
                        // issue" — display text changes to VERIFY (same green styling) to read
                        // as an open action item instead.
                        statusText = "VERIFY";
                        statusFg = GetBrush("GreenBrush");
                        statusBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1AA6E3A1"));
                        break;
                    case "ERROR":
                    case "FAILED":
                        statusFg = GetBrush("RedBrush");
                        statusBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1AF38BA8"));
                        break;
                    case "BLOCKED":
                        statusFg = GetBrush("MauveBrush");
                        statusBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1ACBA6F7"));
                        break;
                    case "RUNNING":
                        statusFg = GetBrush("BlueBrush");
                        statusBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1A89B4FA"));
                        break;
                    case "QUEUED":
                        statusFg = GetBrush("PeachBrush");
                        statusBg = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1AFAB387"));
                        break;
                }

                var statusBorder = new Border
                {
                    Background = statusBg,
                    BorderBrush = statusFg,
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 0, 4, 0),
                    Margin = new Thickness(0, 0, 6, 0),
                    VerticalAlignment = VerticalAlignment.Center
                };
                statusBorder.Child = new TextBlock { Text = statusText, FontSize = 8, FontWeight = FontWeights.Bold, Foreground = statusFg };
                buildSp.Children.Add(statusBorder);

                var tbBuildTitle = new TextBlock
                {
                    Text = $"Build #{build.Id} — {build.Title}",
                    Foreground = GetBrush("TextBrush"),
                    FontSize = 11,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    MaxWidth = 130,
                    VerticalAlignment = VerticalAlignment.Center
                };
                buildSp.Children.Add(tbBuildTitle);

                var tooltipText = $"Build #{build.Id}\nTitle: {build.Title}\nStatus: {build.Status}\nPrompt: {build.Prompt}";
                buildSp.ToolTip = tooltipText;

                buildSp.Margin = new Thickness(0, 0, 6, 4);
                chips.Children.Add(buildSp);
            }

            if (chips.Children.Count > 0) content.Children.Add(chips);
            outer.Children.Add(content);
            card.Child = outer;

            // Click the card to open its chat (same issue-number resolution the old
            // TreeView selection used); hover highlights it.
            card.MouseLeftButtonUp += (s, e) =>
            {
                if (string.IsNullOrEmpty(chat.ClaudeUrl)) return;
                var resolvedEpic = GetEpicForChat(chat);
                int? gh = chat.IssueGithubNumber ?? resolvedEpic?.GithubNumber;
                ChatSelected?.Invoke(this, (chat, gh));
            };
            card.MouseEnter += (s, e) => card.Background = GetBrush("Surface0Brush");
            card.MouseLeave += (s, e) => card.Background = GetBrush("MantleBrush");

            var cm = new ContextMenu();

            // In Progress toggle item
            var miToggleProgress = new MenuItem
            {
                Header = inProgress ? "✓ ⚡ In Progress (Click to Unmark)" : "⚡ Mark as In Progress"
            };
            miToggleProgress.Click += (_, _) =>
            {
                BuildConsole.Services.FocusModeService.Instance.ToggleChatInProgress(chat.ConversationId, chat.Title, chat.ClaudeUrl);
                RenderChatsTree();
            };
            cm.Items.Add(miToggleProgress);

            // Git #2059 — open this chat in the always-on-top floating window (Phase 1
            // of the #2035 Global Chat Drawer). Launched WITHOUT opening the chat as a
            // tab, so Shane can fire a quick message and keep working elsewhere.
            var miFloat = new MenuItem { Header = "🪟 Open as Floating Window" };
            miFloat.IsEnabled = !string.IsNullOrEmpty(chat.ClaudeUrl);
            miFloat.Click += (_, _) =>
                (Application.Current.MainWindow as MainWindow)?.OpenFloatingChatWindow(chat);
            cm.Items.Add(miFloat);

            // Git #2104 — manual/debug create path for the pinned-questions system (#2036).
            // Detection (asking chats for outstanding questions) is Phase 2 (#2105) and doesn't
            // exist yet; this is the "simple manual/debug path" the issue calls for so the pin
            // UI + resolve mechanism can be proven end to end without waiting on detection.
            var miPin = new MenuItem { Header = "📌 Pin a Question..." };
            miPin.IsEnabled = chat.Id > 0 && _db != null;
            miPin.Click += async (_, _) =>
            {
                if (_db == null || chat.Id <= 0) return;

                var inputWin = new Window
                {
                    Title = "Pin a Question",
                    Width = 420,
                    Height = 190,
                    WindowStartupLocation = WindowStartupLocation.CenterOwner,
                    Owner = Application.Current.MainWindow,
                    Background = GetBrush("BaseBrush"),
                    BorderBrush = GetBrush("Surface0Brush"),
                    BorderThickness = new Thickness(1),
                    ResizeMode = ResizeMode.NoResize
                };

                var grid = new Grid { Margin = new Thickness(14) };
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

                var label = new TextBlock
                {
                    Text = $"Question to pin against \"{chat.Title}\":",
                    Foreground = GetBrush("TextBrush"),
                    Margin = new Thickness(0, 0, 0, 8),
                    FontSize = 12,
                    TextWrapping = TextWrapping.Wrap
                };
                Grid.SetRow(label, 0);
                grid.Children.Add(label);

                var txtInput = new TextBox
                {
                    AcceptsReturn = true,
                    Height = 60,
                    TextWrapping = TextWrapping.Wrap,
                    Background = GetBrush("MantleBrush"),
                    Foreground = GetBrush("TextBrush"),
                    BorderBrush = GetBrush("Surface0Brush"),
                    CaretBrush = GetBrush("TextBrush"),
                    Padding = new Thickness(6, 4, 6, 4),
                    Margin = new Thickness(0, 0, 0, 12)
                };
                Grid.SetRow(txtInput, 1);
                grid.Children.Add(txtInput);

                var buttonPanel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
                var btnCancel = new Button { Content = "Cancel", Padding = new Thickness(12, 4, 12, 4), Margin = new Thickness(0, 0, 8, 0) };
                var btnPin = new Button { Content = "Pin", Style = (Style)FindResource("PrimaryButton"), Padding = new Thickness(12, 4, 12, 4) };
                btnCancel.Click += (s2, e2) => inputWin.DialogResult = false;
                btnPin.Click += (s2, e2) => inputWin.DialogResult = true;
                buttonPanel.Children.Add(btnCancel);
                buttonPanel.Children.Add(btnPin);
                Grid.SetRow(buttonPanel, 2);
                grid.Children.Add(buttonPanel);

                inputWin.Content = grid;
                txtInput.Focus();

                if (inputWin.ShowDialog() == true)
                {
                    var question = txtInput.Text?.Trim() ?? "";
                    if (string.IsNullOrEmpty(question)) return;
                    try
                    {
                        bool created = await _db.CreatePinnedQuestionAsync(chat.Id, question);
                        if (created)
                        {
                            ActivityLog.Log("chat.floating", $"pinned a question on chat {chat.ConversationId}: {question}");
                            await LoadPinnedQuestionsAsync();
                        }
                        else
                        {
                            ToastEngine.Warning("Pin a Question", "An identical open pin already exists on this chat.");
                        }
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Pin a Question", $"Couldn't pin the question: {ex.Message}");
                    }
                }
            };
            cm.Items.Add(miPin);

            cm.Items.Add(new Separator());

            // Link / Unlink chat options (many-to-many model)
            var miAssign = new MenuItem { Header = "🔗 Link to Issue/Milestone..." };
            miAssign.Click += async (_, _) =>
            {
                if (_api == null) return;
                var candidates = new List<LinkCandidate>();
                foreach (var m in _lastMilestoneInfos)
                {
                    candidates.Add(new LinkCandidate { Number = m.Number, Title = m.Title });
                }
                foreach (var issue in _lastBoardIssues)
                {
                    candidates.Add(new LinkCandidate { Number = issue.Number, Title = issue.Title });
                }
                candidates.Sort((a, b) => b.Number.CompareTo(a.Number));

                var dialog = new AssignEpicDialog(chat.Title, candidates, "issue/milestone");
                if (dialog.ShowDialog() != true || dialog.SelectedEpicId == null) return;
                int targetNumber = dialog.SelectedEpicId.Value;
                try
                {
                    if (_db != null)
                    {
                        bool resolved = await _db.LinkChatToIssueAsync(chat.ConversationId, targetNumber, resolveLive: ResolveLiveBoardIssue);
                        // Git #2068 — only warn when targetNumber was actually a real board
                        // issue/epic that failed to resolve even with the live-board fallback;
                        // a picked milestone number is EXPECTED to leave epic_id/issue_id unset
                        // (see ResolveLiveBoardIssue's doc comment), not an error.
                        if (!resolved && _lastBoardIssues.Any(i => i.Number == targetNumber))
                        {
                            ToastEngine.Warning("Link Chat", $"Chat linked to #{targetNumber}, but it couldn't be grouped under its epic yet — try again after the Git Board refreshes.");
                            ActivityLog.Log("git-board.assign-chat", $"chat {chat.ConversationId} linked to #{targetNumber} via bt_chat_issues only — epic/issue FK resolution failed (Git #2068)");
                        }
                    }
                    else
                    {
                        if (_api == null) return;
                        var res = await _api.LinkChatToIssueAsync(chat.ConversationId, targetNumber);
                        if (!res.IsSuccessStatusCode)
                        {
                            var body = await res.Content.ReadAsStringAsync();
                            ToastEngine.Error("Link Chat", $"Couldn't link chat: {body}");
                            return;
                        }
                    }
                    chat.AssociatedIssueNumbers ??= new List<int>();
                    if (!chat.AssociatedIssueNumbers.Contains(targetNumber))
                        chat.AssociatedIssueNumbers.Add(targetNumber);
                    _lastBoardSignature = null;
                    PopulateChatsTree();
                }
                catch (System.Exception ex)
                {
                    ToastEngine.Error("Link Chat", $"Couldn't link chat: {ex.Message}");
                }
            };
            cm.Items.Add(miAssign);

            if (chat.AssociatedIssueNumbers != null && chat.AssociatedIssueNumbers.Count > 0)
            {
                var miUnlinkSub = new MenuItem { Header = "💔 Unlink from Issue/Milestone..." };
                foreach (var num in chat.AssociatedIssueNumbers)
                {
                    var issueNum = num;
                    var label = $"#{issueNum}";
                    var matchIssue = _lastBoardIssues.FirstOrDefault(i => i.Number == issueNum);
                    if (matchIssue != null) label += $" — {matchIssue.Title}";
                    else
                    {
                        var matchMilestone = _lastMilestoneInfos.FirstOrDefault(m => m.Number == issueNum);
                        if (matchMilestone != null) label += $" — {matchMilestone.Title}";
                    }
                    var miItem = new MenuItem { Header = label };
                    miItem.Click += async (_, _) =>
                    {
                        try
                        {
                            if (_db != null)
                            {
                                await _db.UnlinkChatFromIssueAsync(chat.ConversationId, issueNum, resolveLive: ResolveLiveBoardIssue);
                            }
                            else
                            {
                                if (_api == null) return;
                                var res = await _api.UnlinkChatFromIssueAsync(chat.ConversationId, issueNum);
                                if (!res.IsSuccessStatusCode)
                                {
                                    var body = await res.Content.ReadAsStringAsync();
                                    ToastEngine.Error("Unlink Chat", $"Couldn't unlink: {body}");
                                    return;
                                }
                            }
                            chat.AssociatedIssueNumbers.Remove(issueNum);
                            _lastBoardSignature = null;
                            PopulateChatsTree();
                        }
                        catch (System.Exception ex)
                        {
                            ToastEngine.Error("Unlink Chat", $"Couldn't unlink: {ex.Message}");
                        }
                    };
                    miUnlinkSub.Items.Add(miItem);
                }
                cm.Items.Add(miUnlinkSub);
            }

            cm.Items.Add(new Separator());

            // Rename option
            var miRename = new MenuItem { Header = "✏️ Rename Chat..." };
            miRename.Click += async (_, _) =>
            {
                var inputWin = new Window
                {
                    Title = "Rename Chat",
                    Width = 400,
                    Height = 150,
                    WindowStartupLocation = WindowStartupLocation.CenterOwner,
                    Owner = Application.Current.MainWindow,
                    Background = GetBrush("BaseBrush"),
                    BorderBrush = GetBrush("Surface0Brush"),
                    BorderThickness = new Thickness(1),
                    ResizeMode = ResizeMode.NoResize
                };
                
                var grid = new Grid { Margin = new Thickness(14) };
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                
                var label = new TextBlock
                {
                    Text = "Enter new title for chat:",
                    Foreground = GetBrush("TextBrush"),
                    Margin = new Thickness(0, 0, 0, 8),
                    FontSize = 12
                };
                Grid.SetRow(label, 0);
                grid.Children.Add(label);
                
                var txtInput = new TextBox
                {
                    Text = chat.Title,
                    Background = GetBrush("MantleBrush"),
                    Foreground = GetBrush("TextBrush"),
                    BorderBrush = GetBrush("Surface0Brush"),
                    CaretBrush = GetBrush("TextBrush"),
                    Padding = new Thickness(6, 4, 6, 4),
                    Margin = new Thickness(0, 0, 0, 12)
                };
                txtInput.SelectAll();
                Grid.SetRow(txtInput, 1);
                grid.Children.Add(txtInput);
                
                var buttonPanel = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
                var btnCancel = new Button { Content = "Cancel", Padding = new Thickness(12, 4, 12, 4), Margin = new Thickness(0, 0, 8, 0) };
                var btnSave = new Button { Content = "Save", Style = (Style)FindResource("PrimaryButton"), Padding = new Thickness(12, 4, 12, 4) };
                
                btnCancel.Click += (s2, e2) => inputWin.DialogResult = false;
                btnSave.Click += (s2, e2) => inputWin.DialogResult = true;
                
                buttonPanel.Children.Add(btnCancel);
                buttonPanel.Children.Add(btnSave);
                Grid.SetRow(buttonPanel, 2);
                grid.Children.Add(buttonPanel);
                
                inputWin.Content = grid;
                txtInput.Focus();
                
                if (inputWin.ShowDialog() == true)
                {
                    var newTitle = txtInput.Text?.Trim() ?? "";
                    if (string.IsNullOrEmpty(newTitle)) return;
                    if (_db == null && _api == null) return;
                    try
                    {
                        if (_db != null)
                        {
                            await _db.RenameChatAsync(chat.ConversationId, newTitle);
                        }
                        else
                        {
                            var res = await _api!.RenameChatAsync(chat.ConversationId, newTitle);
                            if (!res.IsSuccessStatusCode)
                            {
                                var body = await res.Content.ReadAsStringAsync();
                                ToastEngine.Error("Rename Chat", $"Failed to rename: {body}");
                                return;
                            }
                        }
                        chat.Title = newTitle;
                        _lastBoardSignature = null;
                        PopulateChatsTree();
                        ToastEngine.Success("Rename Chat", "Chat renamed successfully.");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Rename Chat", $"Failed to rename: {ex.Message}");
                    }
                }
            };
            cm.Items.Add(miRename);

            // Auto-name option
            if (chat.AssociatedIssueNumbers != null && chat.AssociatedIssueNumbers.Count > 0)
            {
                var miAutoName = new MenuItem { Header = "✨ Auto-Name from Linked Issue(s)" };
                miAutoName.Click += async (_, _) =>
                {
                    if (_db == null && _api == null) return;
                    int firstNum = chat.AssociatedIssueNumbers[0];
                    string? matchedTitle = null;
                    string prefix = $"[#{firstNum}]";
                    
                    var matchIssue = _lastBoardIssues.FirstOrDefault(i => i.Number == firstNum);
                    if (matchIssue != null)
                    {
                        matchedTitle = matchIssue.Title;
                    }
                    else
                    {
                        var matchMilestone = _lastMilestoneInfos.FirstOrDefault(m => m.Number == firstNum);
                        if (matchMilestone != null)
                        {
                            matchedTitle = matchMilestone.Title;
                            prefix = $"[Milestone #{firstNum}]";
                        }
                    }
                    
                    if (string.IsNullOrEmpty(matchedTitle))
                    {
                        ToastEngine.Warning("Auto-Name Chat", $"Could not find issue or milestone #{firstNum} in cached board data.");
                        return;
                    }
                    
                    string newTitle = $"{prefix} {matchedTitle}";
                    try
                    {
                        if (_db != null)
                        {
                            await _db.RenameChatAsync(chat.ConversationId, newTitle);
                        }
                        else
                        {
                            var res = await _api!.RenameChatAsync(chat.ConversationId, newTitle);
                            if (!res.IsSuccessStatusCode)
                            {
                                var body = await res.Content.ReadAsStringAsync();
                                ToastEngine.Error("Auto-Name Chat", $"Failed to rename: {body}");
                                return;
                            }
                        }
                        chat.Title = newTitle;
                        _lastBoardSignature = null;
                        PopulateChatsTree();
                        ToastEngine.Success("Auto-Name Chat", $"Chat renamed to: {newTitle}");
                    }
                    catch (Exception ex)
                    {
                        ToastEngine.Error("Auto-Name Chat", $"Failed to rename: {ex.Message}");
                    }
                };
                cm.Items.Add(miAutoName);
            }

            cm.Items.Add(new Separator());

            // Archive / Unarchive — soft-hide (not delete). The real bt_chats
            // row and every association (bt_chat_issues, epic/issue links) are
            // left fully intact server-side; this just flags the chat out of
            // the default active Chats panel view, reversible from here or from
            // the "Show Archived" toggle above the tree.
            var miArchiveToggle = new MenuItem
            {
                Header = chat.Archived ? "♻ Unarchive Chat" : "🗄 Archive Chat"
            };
            miArchiveToggle.Click += async (_, _) =>
            {
                if (_db == null && _api == null) return;
                bool archiving = !chat.Archived;
                try
                {
                    DateTime? archivedAtUtc;
                    if (_db != null)
                    {
                        // Direct Postgres — this is BuildConsole's own local data
                        // change, not a customer-facing round-trip, so it writes
                        // straight to the real hosted DB same as every other
                        // BuildQueuePostgresClient mutation (no api-server hop).
                        archivedAtUtc = archiving
                            ? await _db.ArchiveChatAsync(chat.ConversationId)
                            : await _db.UnarchiveChatAsync(chat.ConversationId);
                    }
                    else
                    {
                        var res = archiving
                            ? await _api!.ArchiveChatAsync(chat.ConversationId)
                            : await _api!.UnarchiveChatAsync(chat.ConversationId);
                        if (!res.IsSuccessStatusCode)
                        {
                            var body = await res.Content.ReadAsStringAsync();
                            ToastEngine.Error(archiving ? "Archive Chat" : "Unarchive Chat", $"Couldn't {(archiving ? "archive" : "unarchive")} chat: {body}");
                            return;
                        }
                        archivedAtUtc = archiving ? DateTime.UtcNow : null;
                    }

                    chat.Archived = archiving;
                    chat.ArchivedAt = archivedAtUtc;
                    ActivityLog.Log("git-board.archive-chat",
                        $"{(archiving ? "archived" : "unarchived")} chat \"{chat.Title}\" ({chat.ConversationId}) at {DateTime.UtcNow:o}");
                    _lastBoardSignature = null;
                    RenderChatsTree();
                    ToastEngine.Success(archiving ? "Archive Chat" : "Unarchive Chat",
                        archiving ? $"\"{chat.Title}\" archived — enable \"Show Archived\" to find it again." : $"\"{chat.Title}\" restored.");
                }
                catch (System.Exception ex)
                {
                    ToastEngine.Error(archiving ? "Archive Chat" : "Unarchive Chat", $"Couldn't {(archiving ? "archive" : "unarchive")} chat: {ex.Message}");
                }
            };
            cm.Items.Add(miArchiveToggle);

            cm.Items.Add(new Separator());
            var miChatMapping = new MenuItem { Header = "🗺️ Chat Mapping..." };
            miChatMapping.Click += (_, _) =>
            {
                (Application.Current.MainWindow as MainWindow)?.OpenChatMappingsTab();
            };
            cm.Items.Add(miChatMapping);

            card.ContextMenu = cm;

            return card;
        }

        private void ChatSearch_TextChanged(object sender, TextChangedEventArgs e) => RenderChatsTree();

        /// <summary>Git: Chats panel Archive — "Show Archived" toggle above the tree; re-renders from the already-cached board, no re-fetch.</summary>
        private void ChatShowArchived_Changed(object sender, RoutedEventArgs e) => RenderChatsTree();

        /// <summary>Git #1480 — MainWindow calls this when the title-bar Primary/Secondary
        /// account toggle flips, so the Chats panel re-scopes immediately from the already-
        /// cached board (no re-fetch needed — same re-render-only pattern as the search box
        /// and the Show Archived toggle above).</summary>
        public void RefreshForAccountToggle() => RenderChatsTree();

        /// <summary>
        /// Git #1629 (root cause 4) — the tab-level "Assign to Issue..." entry point.
        /// Same issue/milestone picker (AssignEpicDialog over the board's own cached
        /// issues + milestones) and same link path (LinkChatToIssueAsync, which upserts
        /// a missing bt_chats row and stamps the current account per #1480) as the chat
        /// card's "Link to Issue/Milestone..." context-menu item — but the conversation
        /// id comes pre-resolved from an editor tab, so Shane never has to find the
        /// issue node on the Git Board or copy the chat URL by hand. The refresh at the
        /// end is forceFresh: re-linking an already-linked chat changes no DB bytes
        /// (ON CONFLICT DO NOTHING), and the whole point here is a guaranteed repaint.
        /// </summary>
        public async System.Threading.Tasks.Task AssignChatToIssueInteractiveAsync(string conversationId, string chatTitle)
        {
            var candidates = new List<LinkCandidate>();
            foreach (var m in _lastMilestoneInfos)
                candidates.Add(new LinkCandidate { Number = m.Number, Title = m.Title });
            foreach (var issue in _lastBoardIssues)
                candidates.Add(new LinkCandidate { Number = issue.Number, Title = issue.Title });
            candidates.Sort((a, b) => b.Number.CompareTo(a.Number));

            if (candidates.Count == 0)
            {
                ToastEngine.Warning("Assign to Issue",
                    "No issues or milestones are loaded yet — open the Git Board (or click its Refresh) first, then try again.");
                ActivityLog.Log("git-board.assign-chat",
                    $"tab-level assign for chat {conversationId} aborted — board hasn't loaded, no candidates to pick from (Git #1629)");
                return;
            }

            var dialog = new AssignEpicDialog(chatTitle, candidates, "issue/milestone");
            if (dialog.ShowDialog() != true || dialog.SelectedEpicId == null) return;
            int targetNumber = dialog.SelectedEpicId.Value;
            try
            {
                bool resolved = true;
                if (_db != null)
                {
                    resolved = await _db.LinkChatToIssueAsync(conversationId, targetNumber, chatTitle, resolveLive: ResolveLiveBoardIssue);
                }
                else
                {
                    if (_api == null || !_api.IsConfigured)
                    {
                        ToastEngine.Error("Assign to Issue", "Build Tracker API not configured — see Settings.");
                        return;
                    }
                    var res = await _api.LinkChatToIssueAsync(conversationId, targetNumber, chatTitle);
                    if (!res.IsSuccessStatusCode)
                    {
                        var body = await res.Content.ReadAsStringAsync();
                        ActivityLog.Log("git-board.assign-chat",
                            $"tab-level assign chat {conversationId} -> #{targetNumber} FAILED: HTTP {(int)res.StatusCode} {body}");
                        ToastEngine.Error("Assign to Issue", $"Couldn't link chat: {body}");
                        return;
                    }
                }
                ActivityLog.Log("git-board.assign-chat",
                    $"tab-level assign: chat {conversationId} -> #{targetNumber} (Git #1629)");
                // Git #2068 — a real board issue/epic that still failed to resolve (even with the
                // live-board fallback) gets an honest warning instead of a false-success toast; a
                // picked milestone number resolving false is expected (see ResolveLiveBoardIssue).
                if (_db != null && !resolved && _lastBoardIssues.Any(i => i.Number == targetNumber))
                {
                    ToastEngine.Warning("Assign to Issue", $"Chat linked to #{targetNumber}, but it couldn't be grouped under its epic yet — try again after the Git Board refreshes.");
                    ActivityLog.Log("git-board.assign-chat", $"tab-level assign: chat {conversationId} -> #{targetNumber} linked via bt_chat_issues only — epic/issue FK resolution failed (Git #2068)");
                }
                else
                {
                    ToastEngine.Success("Assign to Issue", $"Chat linked to #{targetNumber}");
                }
                PopulateChatsTree(forceFresh: true);
            }
            catch (System.Exception ex)
            {
                ActivityLog.Log("git-board.assign-chat",
                    $"tab-level assign chat {conversationId} -> #{targetNumber} FAILED: {ex.Message}");
                ToastEngine.Error("Assign to Issue", $"Couldn't link chat: {ex.Message}");
            }
        }

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

        /// <summary>Git #2534 — starts a new chat pre-associated to <paramref name="epicNumber"/>,
        /// reusing the exact settings/URL-build/EpicChatRequested path the Git Board's own epic
        /// "New Chat" context-menu item uses (so there is a single new-epic-chat write path). The
        /// forced default title <c>[#N] &lt;Epic Name&gt;</c> becomes both the persisted bt_chats
        /// title and the tab title, and <c>associateIssueNumber</c> makes MainWindow's watcher set
        /// <c>bt_chats.epic_id</c> on the new row the moment the conversation is created
        /// (AssociateChatWithIssueAsync → LinkChatToIssueAsync). Invoked by each epic section's
        /// New Chat / "Continue in a new chat" button.</summary>
        private void StartNewEpicChat(int epicNumber, string epicTitle)
        {
            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
            if (!settings.HasEpicChatProjectUrl)
            {
                ActivityLog.Log("git-board.chat", $"new epic chat #{epicNumber} aborted — no New Chat Project URL configured (Git #2534)");
                ToastEngine.Warning("New Chat", "Set a \"New Chat Project URL\" in the Settings tab first.");
                return;
            }
            var baseUrl = settings.EpicChatProjectUrl.Trim();
            if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out _))
            {
                ActivityLog.Log("git-board.chat", $"new epic chat #{epicNumber} aborted — invalid New Chat Project URL '{baseUrl}' (Git #2534)");
                ToastEngine.Warning("New Chat", "The configured New Chat Project URL isn't a valid URL.");
                return;
            }
            var pat = settings.GitHubPat?.Trim() ?? "";
            var label = $"Epic #{epicNumber}";
            var fullUrl = EpicChatUrlBuilder.BuildEpicChatUrl(baseUrl, pat, epicNumber, label: label);
            var defaultTitle = $"[#{epicNumber}] {epicTitle}";
            ActivityLog.Log("git-board.chat", $"new epic chat #{epicNumber} ('{epicTitle}') from Chats panel -> {baseUrl} (Git #2534)");
            EpicChatRequested?.Invoke(this, (fullUrl, $"#{epicNumber} New Chat", true, epicNumber, "Epic", defaultTitle));
        }

        public BuildConsole.Services.BoardEpic? GetEpicByGithubNumber(int githubNumber)
        {
            return _chatEpicById.Values.FirstOrDefault(e => e.GithubNumber == githubNumber);
        }

        public BuildConsole.Services.BoardEpic? GetEpicForChat(BoardChat chat)
        {
            if (chat == null) return null;

            // 1. If EpicId is directly set
            if (chat.EpicId.HasValue && _chatEpicById.TryGetValue(chat.EpicId.Value, out var epicDirect))
            {
                return epicDirect;
            }

            // 2. Check if IssueGithubNumber is an Epic
            if (chat.IssueGithubNumber.HasValue)
            {
                var epic = GetEpicByGithubNumber(chat.IssueGithubNumber.Value);
                if (epic != null) return epic;

                // If it's a sub-issue, check if that sub-issue has a parent Epic in the issues list
                var issue = _lastBoardIssues.FirstOrDefault(i => i.Number == chat.IssueGithubNumber.Value);
                if (issue != null && issue.ParentNumber.HasValue)
                {
                    epic = GetEpicByGithubNumber(issue.ParentNumber.Value);
                    if (epic != null) return epic;
                }
            }

            // 3. Check if any of AssociatedIssueNumbers is an Epic or a sub-issue under an Epic
            if (chat.AssociatedIssueNumbers != null)
            {
                // First check if any number is directly an Epic
                foreach (var num in chat.AssociatedIssueNumbers)
                {
                    var epic = GetEpicByGithubNumber(num);
                    if (epic != null) return epic;
                }

                // If not, check if any number is a sub-issue of an Epic
                foreach (var num in chat.AssociatedIssueNumbers)
                {
                    var issue = _lastBoardIssues.FirstOrDefault(i => i.Number == num);
                    if (issue != null && issue.ParentNumber.HasValue)
                    {
                        var epic = GetEpicByGithubNumber(issue.ParentNumber.Value);
                        if (epic != null) return epic;
                    }
                }
            }

            return null;
        }

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
            var direct = _lastBoardChats.LastOrDefault(c => c.IssueGithubNumber == githubNumber || c.AssociatedIssueNumbers.Contains(githubNumber));
            if (direct != null) return direct;

            var epic = _chatEpicById.Values.FirstOrDefault(e => e.GithubNumber == githubNumber);
            if (epic == null)
            {
                // Fallback to searching in AssociatedIssueNumbers for all chats
                return _lastBoardChats.LastOrDefault(c => c.AssociatedIssueNumbers.Contains(githubNumber));
            }
            return _lastBoardChats.LastOrDefault(c => c.EpicId == epic.Id || c.AssociatedIssueNumbers.Contains(githubNumber));
        }

        private void ChatsTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is BoardChat chat && !string.IsNullOrEmpty(chat.ClaudeUrl))
            {
                var resolvedEpic = GetEpicForChat(chat);
                int? githubNumber = chat.IssueGithubNumber ?? resolvedEpic?.GithubNumber;
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
            else if (tvi.Tag is GitHubIssueResult searchResult)
            {
                var searchIssue = new GitIssue
                {
                    IssueNumber = searchResult.Number,
                    Title = searchResult.Title,
                    RawTitle = searchResult.Title,
                    Status = searchResult.IsClosed ? "CLOSED" : "OPEN",
                    IsComplete = searchResult.Labels.Any(l => string.Equals(l.Name, "complete", StringComparison.OrdinalIgnoreCase)),
                    IsInFlight = searchResult.HasInFlightLabel,
                    Labels = searchResult.Labels,
                };
                IssueSelected?.Invoke(this, searchIssue);
                GitDetailTabRequested?.Invoke(this, searchIssue);
            }
            else if (tvi.Tag is GitBoardIssue boardIssue)
            {
                var bi = new GitIssue
                {
                    IssueNumber = boardIssue.Number,
                    Title = boardIssue.Title,
                    RawTitle = boardIssue.Title,
                    Status = boardIssue.State,
                    Body = boardIssue.Body,
                    DatabaseId = boardIssue.DatabaseId,
                    IsEpic = boardIssue.IsEpic,
                    IsComplete = boardIssue.IsComplete,
                    HasParentEpic = boardIssue.ParentNumber.HasValue,
                    IsInFlight = boardIssue.HasInFlightLabel,
                    Labels = boardIssue.Labels,
                };
                IssueSelected?.Invoke(this, bi);
                GitDetailTabRequested?.Invoke(this, bi);
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
        ///
        /// Shane (follow-up): "make all Tree Nodes in the Git Board retracted
        /// by default." Flipped the polarity of the SAME persistence idea —
        /// this now tracks nodes MANUALLY EXPANDED (opt-in), defaulting every
        /// node to collapsed, instead of tracking manually-collapsed nodes
        /// against a default-expanded tree. Still keyed the same way, still
        /// survives a full tree rebuild.
        /// </summary>
        private readonly HashSet<string> _expandedNodeKeys = new();

        /// <summary>
        /// Shane: "when I am in Focus Mode on a Milestone with a lot of
        /// Epics, I need the Epic I'm working to be more visually ahead...
        /// I should be able to look at the Git Board Tree View and know
        /// exactly what Epic I'm working." Fed by MainWindow whenever the
        /// active editor tab's chat is tied to an epic (the SAME signal
        /// BuildQueuePanel.SetActiveChatEpic already reacts to, and the SAME
        /// one LeftSidebar.ChatEpicAssigned covers right after an
        /// assignment) — the real GitHub issue number of that epic, or null
        /// when no chat/epic is active. RenderIssuesTree force-expands the
        /// path down to this epic (overriding the collapsed-by-default
        /// change above) and gives its own node a distinct "🎯 WORKING"
        /// treatment so it reads ahead of every other epic at a glance.
        /// </summary>
        private int? _activeEpicGithubNumber;

        public void SetActiveEpicGithubNumber(int? githubNumber)
        {
            if (_activeEpicGithubNumber == githubNumber) return;
            _activeEpicGithubNumber = githubNumber;
            try { RenderIssuesTree(_currentFilter == "Done" ? "All" : _currentFilter); } catch { }
        }

        /// <summary>Git #2483 — lets MainWindow read the currently-active working Epic (if any) so the
        /// Build Chain Map toolbar entry can default to it instead of always prompting Shane.</summary>
        public int? ActiveEpicGithubNumber => _activeEpicGithubNumber;

        private void ActiveWorkingEpicBar_Click(object sender, MouseButtonEventArgs e)
        {
            LocateWorkingEpic();
        }

        /// <summary>
        /// Expands all ancestor parent nodes leading to the active working epic node,
        /// brings the active working node into view, selects it in the tree, and plays
        /// a subtle pulse animation.
        /// </summary>
        public void LocateWorkingEpic()
        {
            if (!_activeEpicGithubNumber.HasValue) return;
            int targetNumber = _activeEpicGithubNumber.Value;

            var tvi = FindAndExpandIssueNode(IssuesTree.Items, targetNumber);
            if (tvi != null)
            {
                tvi.IsSelected = true;
                tvi.BringIntoView();
                IssuesTree.Focus();

                if (tvi.Header is UIElement elem)
                {
                    var trans = new ScaleTransform(1.0, 1.0);
                    elem.RenderTransform = trans;
                    elem.RenderTransformOrigin = new Point(0, 0.5);
                    var anim = new DoubleAnimation(1.0, 1.12, TimeSpan.FromMilliseconds(160))
                    {
                        AutoReverse = true,
                        RepeatBehavior = new RepeatBehavior(2)
                    };
                    trans.BeginAnimation(ScaleTransform.ScaleXProperty, anim);
                    trans.BeginAnimation(ScaleTransform.ScaleYProperty, anim);
                }
            }
            else
            {
                ToastEngine.Info("Git Board", $"Locating Epic #{targetNumber}...");
            }
        }

        private TreeViewItem? FindAndExpandIssueNode(ItemCollection items, int issueNumber, List<TreeViewItem>? ancestors = null)
        {
            ancestors ??= new List<TreeViewItem>();

            foreach (var item in items)
            {
                if (item is TreeViewItem tvi)
                {
                    bool isMatch = false;
                    if (tvi.Tag is GitIssue gi && gi.IssueNumber == issueNumber) isMatch = true;
                    else if (tvi.Tag is GitBoardIssue bi && bi.Number == issueNumber) isMatch = true;
                    else if (tvi.Tag is GitHubIssueResult gr && gr.Number == issueNumber) isMatch = true;
                    else if (tvi.Tag is GitMilestone gm && gm.GithubNumber == issueNumber) isMatch = true;

                    if (isMatch)
                    {
                        // Expand all parent/ancestor nodes that own this WORKING node!
                        foreach (var parent in ancestors)
                        {
                            parent.IsExpanded = true;
                            if (parent.Tag is string key) _expandedNodeKeys.Add(key);
                        }
                        return tvi;
                    }

                    ancestors.Add(tvi);
                    var child = FindAndExpandIssueNode(tvi.Items, issueNumber, ancestors);
                    if (child != null)
                    {
                        tvi.IsExpanded = true;
                        if (tvi.Tag is string key) _expandedNodeKeys.Add(key);
                        return child;
                    }
                    ancestors.RemoveAt(ancestors.Count - 1);
                }
            }
            return null;
        }

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
        private const double IssueNoParentBadgeWidth = 78; // "NO EPIC" bordered pill + its 6px right margin — unaffected by #1785 (text badge, kept as-is)

        // Git #1785 — Working / In Flight / In Flight ↓ / Blocked shrank from full
        // text pills (e.g. the old 88px "🟠 In Flight" IssueInFlightBadgeWidth) down
        // to a single small dot, so one reserve now covers all of them: dot diameter
        // (IssueStatusDotDiameter) + its 6px trailing margin.
        private const double IssueStatusDotDiameter = 9;
        private const double IssueStatusDotReserve = IssueStatusDotDiameter + 6;

        private readonly List<(TextBlock block, double reserve)> _issueTitleBlocks = new();

        /// <summary>Git #1785 — replaces the old full-text status pills ("🟠 In
        /// Flight", "🔴 Blocked", etc.) with a small colored dot, no text, so a
        /// badge-heavy row leaves the title enough width to read on one line again
        /// (see the single-line CharacterEllipsis revert in CreateIssueHeader below).
        /// <paramref name="hollow"/> gives the In-Flight-↓ "descendant" case a
        /// visually distinct hollow ring in the same color instead of a filled
        /// circle, so it's never confused with "this exact issue is in flight" even
        /// with the text gone — the whole point of #1450/#938's original "indicator
        /// all the way down the chain" fix. Kept in sync by hand with the legend row
        /// in LeftSidebar.xaml (no shared source of truth between the two).</summary>
        private Ellipse CreateStatusDot(Brush colorBrush, bool hollow, string tooltip, Thickness margin)
        {
            var dot = new Ellipse
            {
                Width = IssueStatusDotDiameter,
                Height = IssueStatusDotDiameter,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = margin,
                ToolTip = tooltip
            };
            if (hollow)
            {
                dot.Fill = Brushes.Transparent;
                dot.Stroke = colorBrush;
                dot.StrokeThickness = 1.75;
            }
            else
            {
                dot.Fill = colorBrush;
            }
            return dot;
        }

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

        // Git #1679 — chunked dispatcher-frame rendering. #1635 measured this
        // method's imperative TreeViewItem/ContextMenu construction at ~1.5-2s
        // per call at real repo scale (257 open issues / 49 epics / 10
        // milestones), synchronous on the UI thread — every keystroke and
        // critter animation frame stalled for that whole span on every refresh.
        // The construction still happens on the UI thread (WPF requires it),
        // but it now yields back to the dispatcher at DispatcherPriority.
        // Background whenever a burst exceeds ~40ms, so pending input and
        // Render-priority animation ticks interleave between bursts instead of
        // queuing behind one continuous multi-second block. A monotonically
        // increasing version stamp supersedes any in-progress chunked render
        // the moment a newer one starts: the stale pass bails at its next
        // yield point without touching the tree the newer pass is building.
        private int _issuesTreeRenderVersion;
        private const int IssuesTreeChunkBudgetMs = 40;

        private sealed class IssuesTreeRenderPacing
        {
            public int Version;
            public readonly System.Diagnostics.Stopwatch Burst = System.Diagnostics.Stopwatch.StartNew();
            public long MaxBurstMs;
            public long BlockedMsTotal;
            public int BurstCount = 1;
        }

        /// <summary>Yields to the dispatcher if the current construction burst has
        /// exceeded its budget. Returns false when this render has been superseded
        /// by a newer call — the caller must stop building immediately.</summary>
        private async System.Threading.Tasks.Task<bool> YieldIssuesTreeChunkAsync(IssuesTreeRenderPacing pacing)
        {
            if (pacing.Burst.ElapsedMilliseconds < IssuesTreeChunkBudgetMs) return true;
            pacing.MaxBurstMs = Math.Max(pacing.MaxBurstMs, pacing.Burst.ElapsedMilliseconds);
            pacing.BlockedMsTotal += pacing.Burst.ElapsedMilliseconds;
            pacing.BurstCount++;
            await Dispatcher.Yield(DispatcherPriority.Background);
            pacing.Burst.Restart();
            return pacing.Version == _issuesTreeRenderVersion;
        }

        /// <summary>Fire-and-forget wrapper for the many synchronous call sites
        /// (filter chips, focus toggles, active-epic changes). The async body runs
        /// synchronously up to its first yield, so the Clear + stat-tile update
        /// still take effect before this returns — only the bulk TreeViewItem
        /// construction is spread across later dispatcher frames.</summary>
        private async void RenderIssuesTree(string filter)
        {
            try { await RenderIssuesTreeAsync(filter); }
            catch (Exception ex)
            {
                try { ActivityLog.Log("git-board.error", $"RenderIssuesTree failed: {ex.Message}"); } catch { }
            }
        }

        private async System.Threading.Tasks.Task RenderIssuesTreeAsync(string filter)
        {
            var pacing = new IssuesTreeRenderPacing { Version = ++_issuesTreeRenderVersion };
            var wallSw = System.Diagnostics.Stopwatch.StartNew();

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

            var allKnownIssues = shownMilestones.SelectMany(sm => sm.Epics.SelectMany(e => e.Issues)).ToList();

            // Shane, 2026-08-28: "If a parent has children in flight or working
            // there should be an indicator all the way down the chain... I have
            // to expand everything to try and find it." Walk each issue's real
            // ParentNumber chain (the same chain PopulateIssueTreeHierarchy nests
            // the tree on) and mark every ancestor whose sub-tree contains a
            // live in-flight issue, however deep — so a collapsed epic/milestone
            // still tells you something's moving underneath without opening it.
            var issuesByParent = allKnownIssues.Where(i => i.ParentNumber.HasValue).ToLookup(i => i.ParentNumber!.Value);
            bool HasInFlightBelow(GitIssue node, HashSet<int> seen)
            {
                if (!seen.Add(node.IssueNumber)) return false; // cycle guard
                foreach (var child in issuesByParent[node.IssueNumber])
                {
                    if (child.Status != "CLOSED" && child.IsInFlight) return true;
                    if (HasInFlightBelow(child, seen)) return true;
                }
                return false;
            }
            foreach (var issue in allKnownIssues)
            {
                issue.HasInFlightDescendant = HasInFlightBelow(issue, new HashSet<int>());
            }
            foreach (var m in shownMilestones)
            {
                foreach (var bucket in m.Epics)
                {
                    bucket.HasInFlightDescendant = bucket.Issues.Any(ii => ii.Status != "CLOSED" && (ii.IsInFlight || ii.HasInFlightDescendant));
                }
                m.HasInFlightDescendant = m.Epics.Any(ebkt => ebkt.HasInFlightDescendant);
            }

            if (_activeEpicGithubNumber.HasValue)
            {
                var activeIssue = allKnownIssues.FirstOrDefault(i => i.IssueNumber == _activeEpicGithubNumber.Value);
                ActiveWorkingEpicBar.Visibility = Visibility.Visible;
                ActiveWorkingEpicText.Text = $"WORKING: #{_activeEpicGithubNumber.Value} — {(activeIssue != null ? activeIssue.Title : "Active Epic")}";
            }
            else
            {
                ActiveWorkingEpicBar.Visibility = Visibility.Collapsed;
            }

            foreach (var m in shownMilestones)
            {
                if (!await YieldIssuesTreeChunkAsync(pacing)) return;
                if (filter == "Milestones" || filter == "All" || filter == "Priority")
                {
                    string milestoneKey = $"m:{m.Title}";
                    bool milestoneHasActiveEpic = _activeEpicGithubNumber.HasValue
                        && m.Epics.Any(ebkt => ebkt.Issues.Any(ii => ii.IssueNumber == _activeEpicGithubNumber.Value));
                    var milestoneItem = new TreeViewItem
                    {
                        Header = CreateMilestoneHeader(m),
                        IsExpanded = milestoneHasActiveEpic || _expandedNodeKeys.Contains(milestoneKey),
                        // Git #921 (Epic #803) — tag the milestone node with its
                        // real data object so IssuesTree_SelectedItemChanged can
                        // route a click to its detail tab. Was untagged (a purely
                        // decorative header) before this — the whole "make the
                        // milestone clickable" ask.
                        Tag = m
                    };
                    
                    var cmMilestone = new ContextMenu();

                    var miNewIssue = new MenuItem { Header = "New Issue in this Milestone..." };
                    miNewIssue.Click += async (s, e) =>
                    {
                        await CreateNewIssueAsync(m.GithubNumber);
                    };
                    cmMilestone.Items.Add(miNewIssue);

                    var miNewEpic = new MenuItem { Header = "New Epic in this Milestone..." };
                    miNewEpic.Click += async (s, e) =>
                    {
                        await CreateNewIssueAsync(m.GithubNumber, prefillTitle: "EPIC: ");
                    };
                    cmMilestone.Items.Add(miNewEpic);

                    cmMilestone.Items.Add(new Separator());

                    if (m.GithubNumber.HasValue)
                    {
                        var linkedChat = FindChatForIssue(m.GithubNumber.Value);
                        if (linkedChat != null && !string.IsNullOrEmpty(linkedChat.ClaudeUrl))
                        {
                            var chatUrl = linkedChat.ClaudeUrl;
                            var miOpenChat = new MenuItem { Header = "💬 Open Chat" };
                            miOpenChat.Click += (s, e) =>
                            {
                                EpicChatRequested?.Invoke(this, (chatUrl, $"Milestone #{m.GithubNumber.Value} Chat", false, null, "Milestone", m.Title));
                            };
                            cmMilestone.Items.Add(miOpenChat);
                        }
                        else
                        {
                            var miNewChat = new MenuItem { Header = "➕ New Chat" };
                            miNewChat.Click += (s, e) =>
                            {
                                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                                if (!settings.HasEpicChatProjectUrl)
                                {
                                    ToastEngine.Warning("New Chat", "Set a \"New Chat Project URL\" in the Settings tab first.");
                                    return;
                                }
                                var baseUrl = settings.EpicChatProjectUrl.Trim();
                                var pat = settings.GitHubPat?.Trim() ?? "";
                                var label = $"Milestone #{m.GithubNumber.Value}";
                                var fullUrl = EpicChatUrlBuilder.BuildEpicChatUrl(baseUrl, pat, m.GithubNumber.Value, label: label);
                                EpicChatRequested?.Invoke(this, (fullUrl, $"Milestone #{m.GithubNumber.Value} New Chat", true, m.GithubNumber.Value, "Milestone", $"[Milestone #{m.GithubNumber.Value}] {m.Title}"));
                            };
                            cmMilestone.Items.Add(miNewChat);
                        }

                        var miAssignChat = new MenuItem { Header = "🔗 Assign Chat to Milestone..." };
                        miAssignChat.Click += async (s, e) =>
                        {
                            if (_api == null || !_api.IsConfigured)
                            {
                                ToastEngine.Warning("Assign Chat to Milestone", "Build Tracker API isn't configured.");
                                return;
                            }
                            var existingChat = FindChatForIssue(m.GithubNumber.Value);
                            var dialog = new AssignChatToEpicDialog($"Milestone #{m.GithubNumber.Value}", existingChat?.ClaudeUrl, GetActiveChatUrl);
                            if (dialog.ShowDialog() != true || string.IsNullOrWhiteSpace(dialog.ResultChatUrl)) return;
                            var chatUrl = dialog.ResultChatUrl.Trim();
                            var convMatch = System.Text.RegularExpressions.Regex.Match(chatUrl, @"/chat/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})");
                            if (!convMatch.Success)
                            {
                                ToastEngine.Warning("Assign Chat to Milestone", "That doesn't look like a chat URL.");
                                return;
                            }
                            var conversationId = convMatch.Groups[1].Value;
                            try
                            {
                                if (_db != null)
                                {
                                    // Git #2068 audit — deliberately NO resolveLive here: m.GithubNumber
                                    // is a real GitHub Milestone number, a different number namespace from
                                    // _lastBoardIssues (real issues/epics), so it was never expected to
                                    // resolve to a local epic/issue row — bt_chat_issues (Step 3, already
                                    // unconditional) is the sole intended persistence for a milestone-only
                                    // link, and it already works. Passing resolveLive here would risk
                                    // accidentally attaching the chat to an unrelated real issue that
                                    // happens to share the same number as this milestone.
                                    await _db.LinkChatToIssueAsync(conversationId, m.GithubNumber.Value, $"[Milestone #{m.GithubNumber.Value}] {m.Title}");
                                }
                                else
                                {
                                    var res = await _api.LinkChatToIssueAsync(conversationId, m.GithubNumber.Value, $"[Milestone #{m.GithubNumber.Value}] {m.Title}");
                                    if (!res.IsSuccessStatusCode)
                                    {
                                        var body = await res.Content.ReadAsStringAsync();
                                        ToastEngine.Error("Assign Chat to Milestone", $"Couldn't assign: {body}");
                                        return;
                                    }
                                }
                                // Update local state
                                var targetChat = _lastBoardChats.FirstOrDefault(c => c.ConversationId == conversationId);
                                if (targetChat != null)
                                {
                                    if (!targetChat.AssociatedIssueNumbers.Contains(m.GithubNumber.Value))
                                        targetChat.AssociatedIssueNumbers.Add(m.GithubNumber.Value);
                                    targetChat.ClaudeUrl = chatUrl;
                                }
                                else
                                {
                                    _lastBoardChats.Add(new BoardChat
                                    {
                                        ConversationId = conversationId,
                                        Title = $"[Milestone #{m.GithubNumber.Value}] {m.Title}",
                                        ClaudeUrl = chatUrl,
                                        AssociatedIssueNumbers = new List<int> { m.GithubNumber.Value },
                                        // Git #1480 — optimistic add, immediately superseded by the real
                                        // fetch below (PopulateChatsTree); stamped so it doesn't flash out
                                        // of view for that one frame if the current toggle is Secondary.
                                        Account = BuildConsole.Services.BuildConsoleSettings.CurrentAccountLabel(),
                                    });
                                }
                                PopulateChatsTree();
                            }
                            catch (Exception ex)
                            {
                                ToastEngine.Error("Assign Chat to Milestone", $"Couldn't assign: {ex.Message}");
                            }
                        };
                        cmMilestone.Items.Add(miAssignChat);
                        cmMilestone.Items.Add(new Separator());
                    }

                    var miNewEpicAssign = new MenuItem { Header = "New Epic & Assign Loose Issues..." };
                    miNewEpicAssign.Click += async (s, e) =>
                    {
                        var looseBucket = m.Epics.FirstOrDefault(ep => ep.Title == "⚡ Issues");
                        if (looseBucket == null || looseBucket.Issues.Count == 0)
                        {
                            ToastEngine.Error("Git Board", "No loose issues in this milestone to assign.");
                            return;
                        }

                        // Open NewIssueDialog but with EPIC: prefilled
                        var dialog = new NewIssueDialog(new List<GitBoardIssue>(), "EPIC: ");
                        dialog.Owner = Application.Current.MainWindow;
                        if (dialog.ShowDialog() != true) return;

                        var newTitle = dialog.IssueTitle;
                        var newBody = dialog.IssueBody;
                        if (string.IsNullOrWhiteSpace(newTitle)) return;

                        try
                        {
                            var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                            if (!settings.HasGitHubPat) return;
                            var client = new GitHubApiClient(settings.GitHubPat);
                            
                            var created = await client.CreateIssueAsync(newTitle, newBody, m.GithubNumber);
                            
                            foreach (var li in looseBucket.Issues)
                            {
                                await client.AddSubIssueAsync(created.Number, li.DatabaseId);
                            }

                            ActivityLog.Log("git-board.new-epic", $"Created Epic #{created.Number} and assigned {looseBucket.Issues.Count} issues.");
                            ToastEngine.Success("Git Board", $"Epic #{created.Number} created and loose issues assigned!");
                            
                            PopulateGitTrackerBoard();
                        }
                        catch (Exception ex)
                        {
                            ActivityLog.Log("git-board.error", $"Failed to create Epic: {ex.Message}");
                            ToastEngine.Error("Git Board", $"Failed to create Epic: {ex.Message}");
                        }
                    };
                    cmMilestone.Items.Add(miNewEpicAssign);

                    // ── Close Milestone ──────────────────────────────────────────
                    if (m.GithubNumber.HasValue && !m.IsClosed)
                    {
                        cmMilestone.Items.Add(new Separator());

                        var miCloseMilestone = new MenuItem { Header = "🎉 Close Milestone…" };
                        miCloseMilestone.Click += async (s, e) =>
                        {
                            var result = MessageBox.Show(
                                $"Close milestone \"{m.Title}\"?\n\nThis will mark it as closed on GitHub and trigger a HUGE celebration!",
                                "Close Milestone",
                                MessageBoxButton.YesNo,
                                MessageBoxImage.Question);

                            if (result != MessageBoxResult.Yes) return;

                            try
                            {
                                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                                if (!settings.HasGitHubPat) return;
                                var client = new GitHubApiClient(settings.GitHubPat);
                                await client.CloseMilestoneAsync(m.GithubNumber.Value);
                                ActivityLog.Log("git-board.close-milestone", $"Milestone \"{m.Title}\" (#{m.GithubNumber.Value}) closed on GitHub!");
                                ToastEngine.Success("🎉 Milestone Closed!", $"\"{m.Title}\" has been closed!");

                                // 🎉🎊🥳 THE BIG PARTY! 🥳🎊🎉
                                IssueChompAnimation.PlayMilestoneClosedParty(milestoneItem, m.Title);

                                // Invalidate cache & force fresh board fetch
                                _cachedMilestoneInfos = null;
                                _lastInProgressSignature = null;
                                PopulateGitTrackerBoard(forceFresh: true);
                            }
                            catch (Exception ex)
                            {
                                ActivityLog.Log("git-board.close-milestone", $"Failed to close milestone \"{m.Title}\": {ex.Message}");
                                ToastEngine.Error("Git Board", $"Couldn't close milestone: {ex.Message}");
                            }
                        };
                        cmMilestone.Items.Add(miCloseMilestone);
                    }

                    milestoneItem.ContextMenu = cmMilestone;

                    milestoneItem.Collapsed += (s, e) => { if (ReferenceEquals(e.OriginalSource, milestoneItem)) _expandedNodeKeys.Remove(milestoneKey); };
                    milestoneItem.Expanded += (s, e) => { if (ReferenceEquals(e.OriginalSource, milestoneItem)) _expandedNodeKeys.Add(milestoneKey); };

                    foreach (var epicBucket in m.Epics)
                    {
                        if (!await YieldIssuesTreeChunkAsync(pacing)) return;
                        string bucketKey = $"e:{m.Title}/{epicBucket.Title}";
                        bool bucketHasActiveEpic = _activeEpicGithubNumber.HasValue
                            && epicBucket.Issues.Any(ii => ii.IssueNumber == _activeEpicGithubNumber.Value);
                        var bucketItem = new TreeViewItem
                        {
                            Header = CreateEpicHeader(epicBucket),
                            IsExpanded = bucketHasActiveEpic || _expandedNodeKeys.Contains(bucketKey)
                        };
                        bucketItem.Collapsed += (s, e) => { if (ReferenceEquals(e.OriginalSource, bucketItem)) _expandedNodeKeys.Remove(bucketKey); };
                        bucketItem.Expanded += (s, e) => { if (ReferenceEquals(e.OriginalSource, bucketItem)) _expandedNodeKeys.Add(bucketKey); };

                        if (epicBucket.Title == "⚡ Epics")
                        {
                            // Epics bucket: top-level epics with their sub-issues nested beneath them
                            var topEpics = epicBucket.Issues
                                .Where(e => e.ParentNumber == null || !allKnownIssues.Any(p => p.IssueNumber == e.ParentNumber))
                                .ToList();

                            foreach (var epicIssue in topEpics)
                            {
                                if (filter != "Done" && epicIssue.Status == "CLOSED") continue;
                                if (filter == "Done" && epicIssue.Status != "CLOSED") continue;
                                if (filter == "Priority" && epicIssue.Priority != "HIGH") continue;

                                if (!await YieldIssuesTreeChunkAsync(pacing)) return;
                                var epicNode = CreateIssueHeader(epicIssue, depth: 2);
                                if (!await PopulateIssueTreeHierarchyAsync(epicNode.Items, allKnownIssues, epicIssue.IssueNumber, filter, 3, pacing)) return;
                                bucketItem.Items.Add(epicNode);
                            }
                        }
                        else if (epicBucket.Title == "⚡ Issues")
                        {
                            // Issues bucket: standalone issues (not attached to an in-milestone epic), with any sub-issues nested
                            var standaloneIssues = epicBucket.Issues
                                .Where(i => i.ParentNumber == null || !allKnownIssues.Any(p => p.IssueNumber == i.ParentNumber))
                                .ToList();

                            foreach (var issue in standaloneIssues)
                            {
                                if (filter != "Done" && issue.Status == "CLOSED") continue;
                                if (filter == "Done" && issue.Status != "CLOSED") continue;
                                if (filter == "Priority" && issue.Priority != "HIGH") continue;

                                if (!await YieldIssuesTreeChunkAsync(pacing)) return;
                                var issueNode = CreateIssueHeader(issue, depth: 2);
                                if (!await PopulateIssueTreeHierarchyAsync(issueNode.Items, allKnownIssues, issue.IssueNumber, filter, 3, pacing)) return;
                                bucketItem.Items.Add(issueNode);
                            }
                        }
                        else if (epicBucket.Title.Contains("Shane To-Do") || epicBucket.Title.Contains("To-Do"))
                        {
                            // Shane To-Do bucket: display ALL items marked for Shane directly, even if attached to an epic
                            foreach (var issue in epicBucket.Issues)
                            {
                                if (filter != "Done" && issue.Status == "CLOSED") continue;
                                if (filter == "Done" && issue.Status != "CLOSED") continue;
                                if (filter == "Priority" && issue.Priority != "HIGH") continue;

                                if (!await YieldIssuesTreeChunkAsync(pacing)) return;
                                var issueNode = CreateIssueHeader(issue, depth: 2);
                                if (!await PopulateIssueTreeHierarchyAsync(issueNode.Items, allKnownIssues, issue.IssueNumber, filter, 3, pacing)) return;
                                bucketItem.Items.Add(issueNode);
                            }
                        }
                        else
                        {
                            // Custom buckets: top-level items with any sub-issues nested
                            var topItems = epicBucket.Issues
                                .Where(i => i.ParentNumber == null || !allKnownIssues.Any(p => p.IssueNumber == i.ParentNumber))
                                .ToList();

                            foreach (var issue in topItems)
                            {
                                if (filter != "Done" && issue.Status == "CLOSED") continue;
                                if (filter == "Done" && issue.Status != "CLOSED") continue;
                                if (filter == "Priority" && issue.Priority != "HIGH") continue;

                                if (!await YieldIssuesTreeChunkAsync(pacing)) return;
                                var issueNode = CreateIssueHeader(issue, depth: 2);
                                if (!await PopulateIssueTreeHierarchyAsync(issueNode.Items, allKnownIssues, issue.IssueNumber, filter, 3, pacing)) return;
                                bucketItem.Items.Add(issueNode);
                            }
                        }

                        if (bucketItem.Items.Count > 0 || filter == "All" || filter == "Epics")
                        {
                            milestoneItem.Items.Add(bucketItem);
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

            // Git #1679 — close out the final burst and log the real shape of this
            // render: wall time vs. cumulative UI-thread-blocked time vs. the
            // longest single continuous burst (the number that decides whether
            // typing/animation can stall — pre-#1679 it equaled the whole wall time).
            pacing.MaxBurstMs = Math.Max(pacing.MaxBurstMs, pacing.Burst.ElapsedMilliseconds);
            pacing.BlockedMsTotal += pacing.Burst.ElapsedMilliseconds;
            ActivityLog.Log("git-board.data",
                $"RenderIssuesTree (chunked, #1679): {wallSw.ElapsedMilliseconds}ms wall, " +
                $"{pacing.BlockedMsTotal}ms UI-thread construction across {pacing.BurstCount} burst(s), " +
                $"longest single burst {pacing.MaxBurstMs}ms");
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

            bool containsActiveEpic = _activeEpicGithubNumber.HasValue
                && m.Epics.Any(ebkt => ebkt.Issues.Any(ii => ii.IssueNumber == _activeEpicGithubNumber.Value));
            if (containsActiveEpic)
            {
                p.Children.Add(CreateStatusDot(GetBrush("GreenBrush"), hollow: false,
                    "Contains your active WORKING epic", new Thickness(8, 0, 0, 0)));
            }

            // Shane, 2026-08-28 — "an indicator all the way down the chain" so a
            // collapsed milestone still shows something's in flight beneath it
            // without expanding. Same amber dot as the issue row's own "In Flight"
            // dot, distinguished by the hollow ring (see CreateStatusDot).
            if (m.HasInFlightDescendant)
            {
                p.Children.Add(CreateStatusDot(new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FAB387")), hollow: true,
                    "Something inside this milestone is in flight right now", new Thickness(8, 0, 0, 0)));
            }

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
                + (m.HasRealCounts ? MilestoneBadgeWidth : 0)
                + (containsActiveEpic ? IssueStatusDotReserve : 0)
                + (m.HasInFlightDescendant ? IssueStatusDotReserve : 0)));
            return p;
        }

        private UIElement CreateEpicHeader(GitEpic e)
        {
            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 2) };
            var titleBlock = new TextBlock { Text = e.Title, FontWeight = FontWeights.SemiBold, FontSize = 11, Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString(e.ColorHex)), TextTrimming = TextTrimming.CharacterEllipsis };
            p.Children.Add(titleBlock);
            p.Children.Add(new TextBlock { Text = $" ({e.Issues.Count})", FontSize = 10, Foreground = GetBrush("Subtext0Brush"), Margin = new Thickness(4, 0, 0, 0) });

            bool containsActiveEpic = _activeEpicGithubNumber.HasValue
                && e.Issues.Any(ii => ii.IssueNumber == _activeEpicGithubNumber.Value);
            if (containsActiveEpic)
            {
                p.Children.Add(CreateStatusDot(GetBrush("GreenBrush"), hollow: false,
                    "Contains your active WORKING epic", new Thickness(6, 0, 0, 0)));
            }

            // Shane, 2026-08-28 — same collapsed "something's in flight below"
            // indicator as CreateMilestoneHeader, scoped to this bucket.
            if (e.HasInFlightDescendant)
            {
                p.Children.Add(CreateStatusDot(new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FAB387")), hollow: true,
                    "Something inside this section is in flight right now", new Thickness(6, 0, 0, 0)));
            }

            // Git #938 — epic rows sit at depth 1 (nested under a milestone): two
            // expander columns of indentation + the " (N)" issue-count suffix.
            _issueTitleBlocks.Add((titleBlock,
                IssueTreeIndentPerLevel * 2 + IssueTreeChrome + EpicCountWidth
                + (containsActiveEpic ? IssueStatusDotReserve : 0)
                + (e.HasInFlightDescendant ? IssueStatusDotReserve : 0)));
            return p;
        }

        // Git #1679 — async so deep sub-issue chains (an epic with dozens of
        // children builds its whole subtree in here, not in RenderIssuesTree's
        // own loops) also honor the chunk budget instead of forming one long
        // uninterruptible burst. Returns false when the render was superseded —
        // the caller must stop building and return immediately.
        private async System.Threading.Tasks.Task<bool> PopulateIssueTreeHierarchyAsync(
            ItemCollection targetItems,
            List<GitIssue> allMilestoneIssues,
            int parentNumber,
            string filter,
            int depth,
            IssuesTreeRenderPacing pacing)
        {
            var children = allMilestoneIssues
                .Where(i => i.ParentNumber == parentNumber)
                .OrderByDescending(i => i.IssueNumber)
                .ToList();

            foreach (var issue in children)
            {
                if (filter != "Done" && issue.Status == "CLOSED") continue;
                if (filter == "Done" && issue.Status != "CLOSED") continue;
                if (filter == "Priority" && issue.Priority != "HIGH") continue;

                if (!await YieldIssuesTreeChunkAsync(pacing)) return false;
                var tvi = CreateIssueHeader(issue, depth);
                if (!await PopulateIssueTreeHierarchyAsync(tvi.Items, allMilestoneIssues, issue.IssueNumber, filter, depth + 1, pacing)) return false;
                targetItems.Add(tvi);
            }
            return true;
        }

        private TreeViewItem CreateIssueHeader(GitIssue issue, int depth = 2)
        {
            bool isActiveEpic = issue.IsEpic && _activeEpicGithubNumber.HasValue && issue.IssueNumber == _activeEpicGithubNumber.Value;

            var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 1, 0, 1) };

            // Git #1768 — every badge below gets an explicit VerticalAlignment=Top.
            // They previously relied on the default Stretch, which was invisible
            // while every row was a single text line (the badges' own natural
            // height already matched the row height). Now that the title can wrap
            // to 2 lines and grow the row, Stretch would inflate each badge's
            // Border to the new, taller row height, changing their apparent size —
            // Top keeps every badge pinned to its original, unchanged dimensions
            // while only the title flows into the extra vertical room.
            var prioBlock = new TextBlock { Text = (issue.IsEpic ? "⚡" : issue.PriorityBadge) + " ", FontSize = 11, VerticalAlignment = VerticalAlignment.Top };

            var numBlock = new Border
            {
                Background = GetBrush("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Top
            };
            numBlock.Child = new TextBlock { Text = issue.NumberStr, FontSize = 10, FontWeight = FontWeights.Bold, Foreground = issue.IsEpic ? GetBrush("MauveBrush") : GetBrush("PeachBrush") };

            // Git #1785 — reverted #1768's TextWrapping.Wrap/2-line cap back to
            // single-line CharacterEllipsis. #1768 was the right fix for the
            // problem it solved (titles crushed to 2-3 characters by stacked text
            // pills), but #1785 shrinks the badges themselves down to dots instead,
            // which frees up enough width that wrapping is no longer needed in the
            // common case — Shane's actual ask was a cleaner single-line tree, not
            // a taller one.
            var titleBlock = new TextBlock
            {
                Text = issue.Title,
                FontSize = 11,
                Foreground = isActiveEpic ? GetBrush("GreenBrush") : issue.Status == "CLOSED" ? GetBrush("Subtext0Brush") : GetBrush("TextBrush"),
                FontWeight = (issue.IsEpic || isActiveEpic) ? FontWeights.Bold : FontWeights.Normal,
                TextDecorations = issue.Status == "CLOSED" ? TextDecorations.Strikethrough : null,
                TextTrimming = TextTrimming.CharacterEllipsis
            };

            p.Children.Add(prioBlock);
            p.Children.Add(numBlock);

            // Shane: "I need a way for the Epic I'm working to be more
            // visually ahead... I should be able to look at the Git Board
            // Tree View and know exactly what Epic I'm working." Git #1785:
            // dot instead of a text pill, plus the accent-green title above and
            // the left-bar wrap below still carry the rest of the signal.
            if (isActiveEpic)
            {
                p.Children.Add(CreateStatusDot(GetBrush("GreenBrush"), hollow: false,
                    "This is the epic tied to your currently active chat", new Thickness(0, 0, 6, 0)));
            }

            // Git #1785: not part of this ask's badge table (only Working/In
            // Flight/In Flight ↓/Blocked/Waiting-for-input are) — left as the
            // existing text pill per the issue's own "don't change what's not
            // asked" instruction.
            bool showsNoParent = false;
            if (!issue.IsEpic && !issue.HasParentEpic && issue.Status != "CLOSED")
            {
                var noParentBadge = new Border
                {
                    Background = GetBrush("PeachBrush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(0, 0, 6, 0),
                    ToolTip = "No parent Epic"
                };
                noParentBadge.Child = new TextBlock { Text = "NO EPIC", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = Brushes.Black };
                p.Children.Add(noParentBadge);
                showsNoParent = true;
            }

            // Git #1368 — real "in-flight" GitHub label (whatever build session
            // is actively working this issue right now). Git #1785: solid dot,
            // same amber/orange #FAB387 as before — deliberately NOT the Blocked
            // dot's red #F38BA8, so the two are never confused at a glance even
            // when both show on the same row.
            if (issue.Status != "CLOSED" && issue.IsInFlight)
            {
                p.Children.Add(CreateStatusDot(new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FAB387")), hollow: false,
                    "A build session is actively working this issue right now", new Thickness(0, 0, 6, 0)));
            }

            // Shane, 2026-08-28: "If a parent has children in flight or working
            // there should be an indicator all the way down the chain... I have
            // to expand everything to try and find it." This issue isn't itself
            // in flight, but a sub-issue somewhere beneath it (however deep) is.
            // Git #1785: same amber as the dot above, but a HOLLOW ring instead of
            // solid fill — the chosen distinguishable treatment so "in flight
            // right here" vs. "in flight somewhere below" stay visually distinct
            // even with the text/down-arrow gone (the whole point of #1450/#938's
            // original fix).
            bool showsInFlightDescendant = issue.Status != "CLOSED" && !issue.IsInFlight && issue.HasInFlightDescendant;
            if (showsInFlightDescendant)
            {
                p.Children.Add(CreateStatusDot(new SolidColorBrush((Color)ColorConverter.ConvertFromString("#FAB387")), hollow: true,
                    "A sub-issue further down the chain is in flight right now", new Thickness(0, 0, 6, 0)));
            }

            // Git #845 (Git Board Phase 7) — real still-OPEN blocked_by
            // dependency (EnrichBlockedStatusAsync). Git #1785: solid red dot
            // instead of the old "🔴 Blocked" text pill.
            if (issue.Status != "CLOSED" && issue.IsBlocked)
            {
                p.Children.Add(CreateStatusDot(new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")), hollow: false,
                    issue.BlockedByNumber.HasValue ? $"Blocked by #{issue.BlockedByNumber}: {issue.BlockedByTitle}" : "Blocked",
                    new Thickness(0, 0, 6, 0)));
            }

            p.Children.Add(titleBlock);

            // Git #938 — issue rows sit at depth. Git #1785: every status dot
            // (working/in-flight/in-flight-descendant/blocked) now reserves the
            // same small IssueStatusDotReserve instead of its own wide text-pill
            // width; only the still-text "NO EPIC" badge keeps its old reserve.
            bool showsBlocked = issue.Status != "CLOSED" && issue.IsBlocked;
            bool showsInFlight = issue.Status != "CLOSED" && issue.IsInFlight;
            _issueTitleBlocks.Add((titleBlock,
                IssueTreeIndentPerLevel * (depth + 1) + IssueTreeChrome + IssuePriorityBadgeWidth + IssueNumberBadgeWidth
                + (isActiveEpic ? IssueStatusDotReserve : 0)
                + (showsBlocked ? IssueStatusDotReserve : 0) + (showsInFlight ? IssueStatusDotReserve : 0) + (showsNoParent ? IssueNoParentBadgeWidth : 0)
                + (showsInFlightDescendant ? IssueStatusDotReserve : 0)));

            // Left accent bar + subtle background tint so the active epic
            // reads ahead of every sibling epic even before you read its
            // badge/title colour — the "more visually ahead" ask.
            FrameworkElement header = p;
            if (isActiveEpic)
            {
                header = new Border
                {
                    BorderBrush = GetBrush("GreenBrush"),
                    BorderThickness = new Thickness(3, 0, 0, 0),
                    Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#1AA6E3A1")),
                    Padding = new Thickness(6, 2, 4, 2),
                    Margin = new Thickness(-6, 0, 0, 0),
                    Child = p
                };
            }

            // Git #2061 — Git Board issue-hover quick-action popover. p has no explicit
            // Background, so without one WPF only hit-tests the individual child elements
            // (badges/title), not the gaps between them, which would make MouseEnter/Leave
            // flicker as the cursor drifts across the row. Transparent gives the whole row a
            // stable hit-test surface for the hover mechanism below.
            p.Background = Brushes.Transparent;
            header.MouseEnter += (s, e) => ScheduleIssueHoverShow(issue, header);
            header.MouseLeave += (s, e) => ScheduleIssueHoverHide();

            string nodeKey = $"issue:{issue.IssueNumber}";
            var tvi = new TreeViewItem
            {
                Header = header,
                Tag = issue,
                IsExpanded = isActiveEpic || _expandedNodeKeys.Contains(nodeKey)
            };
            tvi.Collapsed += (s, e) => { if (ReferenceEquals(e.OriginalSource, tvi)) _expandedNodeKeys.Remove(nodeKey); };
            tvi.Expanded += (s, e) => { if (ReferenceEquals(e.OriginalSource, tvi)) _expandedNodeKeys.Add(nodeKey); };

            // Real toggle - Shane: "Feel free to change anything to patch how I
            // actually work." This tree is live GitHub data now, so a purely
            // local status flip (the old demo behavior) would silently revert
            // on the next real refresh, looking like it worked when nothing
            // actually changed. Toggles the real `complete` label via the same
            // endpoint the extension's own Mark-In-Progress button uses. No
            // real "priority" concept exists anywhere in Build Tracker, so
            // that fake menu item is gone rather than left as a no-op.
            var cm = new ContextMenu();

            // 1. Label workflow: Mark Complete (Ready for Review)
            var miToggle = new MenuItem { Header = issue.IsComplete ? "Remove 'complete' label" : "✓ Mark Complete (Ready for Review)" };
            miToggle.Click += async (s, e) =>
            {
                if (_api == null) return;
                try
                {
                    await _api.ToggleLabelAsync(issue.IssueNumber, "complete", !issue.IsComplete);
                    ActivityLog.Log("git-board.label", $"#{issue.IssueNumber} complete label -> {!issue.IsComplete}");
                    ToastEngine.Success("Git Board", $"Issue #{issue.IssueNumber} marked {(issue.IsComplete ? "incomplete" : "complete (Ready for Review)")}.");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.label", $"#{issue.IssueNumber} label toggle FAILED: {ex.Message}");
                    ToastEngine.Error("Git Board", $"Couldn't toggle complete label on #{issue.IssueNumber}: {ex.Message}");
                    return;
                }
                _lastInProgressSignature = null;
                PopulateGitTrackerBoard(forceFresh: true);
            };
            cm.Items.Add(miToggle);

            // 2. Real GitHub Issue State: Close Issue / Reopen Issue
            var miState = new MenuItem { Header = issue.Status == "CLOSED" ? "↩ Reopen Issue" : "✕ Close Issue" };
            miState.Click += async (s, e) =>
            {
                var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat)
                {
                    ToastEngine.Warning("Git Board", "GitHub PAT not configured — set one in Settings to close issues.");
                    return;
                }
                bool closing = issue.Status != "CLOSED";
                if (closing)
                {
                    // Send in a large critter for epics, or standard critter for issues
                    if (issue.IsEpic)
                        IssueChompAnimation.PlayEpic(tvi, $"#{issue.IssueNumber} {issue.Title}");
                    else
                        IssueChompAnimation.Play(tvi, $"#{issue.IssueNumber} {issue.Title}");
                }
                try
                {
                    var client = new GitHubApiClient(settings.GitHubPat);
                    await client.SetIssueStateAsync(issue.IssueNumber, closing);
                    ActivityLog.Log("git-board.state-change", $"#{issue.IssueNumber} -> {(closing ? "closed" : "reopened")}");
                    ToastEngine.Success("Git Board", $"Issue #{issue.IssueNumber} {(closing ? "closed" : "reopened")}.");
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.state-change", $"#{issue.IssueNumber} state change FAILED: {ex.Message}");
                    ToastEngine.Error("Git Board", $"Couldn't {(closing ? "close" : "reopen")} #{issue.IssueNumber}: {ex.Message}");
                    return;
                }
                _lastInProgressSignature = null;
                _boardShowsClosed = false;
                _lastBlockedEnrichUtc = DateTime.MinValue;
                PopulateGitTrackerBoard(forceFresh: true);
                RefreshGitStatus();
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

                    // Blocked mascot animation — Whammy or one of the 10 mean critters.
                    IssueChompAnimation.PlayBlocked(tvi, $"#{issue.IssueNumber} {issue.RawTitle}", blocker.Number);
                }
                catch (Exception ex)
                {
                    ActivityLog.Log("git-board.set-blocked-by", $"#{issue.IssueNumber} -> #{blocker.Number} FAILED: {ex.Message}");
                    ToastEngine.Error("Set Blocked By", $"Couldn't set #{issue.IssueNumber} blocked by #{blocker.Number}: {ex.Message}");
                    return;
                }
                _lastInProgressSignature = null;
                _lastBlockedEnrichUtc = DateTime.MinValue; // Git #1367 — reflect the just-set block on the next board build instead of waiting out the enrich throttle
                PopulateGitTrackerBoard();
            };
            cm.Items.Add(miSetBlockedBy);

            if (issue.IsBlocked)
            {
                var miUnblock = new MenuItem { Header = "🔓 Remove Blocker (Unblock)" };
                miUnblock.Click += async (s, e) =>
                {
                    var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                    if (!settings.HasGitHubPat) return;
                    try
                    {
                        var client = new GitHubApiClient(settings.GitHubPat);
                        await client.RemoveBlockedAsync(issue.IssueNumber, issue.BlockedByNumber);
                        ActivityLog.Log("git-board.unblock", $"#{issue.IssueNumber} unblocked manually");

                        // Sparky the Keymaster Bunny Unblock Animation!
                        IssueChompAnimation.PlayUnblock(tvi, $"#{issue.IssueNumber} {issue.RawTitle}", issue.BlockedByNumber);
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log("git-board.unblock", $"#{issue.IssueNumber} unblock FAILED: {ex.Message}");
                        ToastEngine.Error("Unblock Issue", $"Couldn't unblock #{issue.IssueNumber}: {ex.Message}");
                        return;
                    }
                    _lastInProgressSignature = null;
                    _lastBlockedEnrichUtc = DateTime.MinValue; // Git #1367 — clear the badge on the next board build instead of waiting out the enrich throttle
                    PopulateGitTrackerBoard();
                };
                cm.Items.Add(miUnblock);
            }

            // Git #922 (Epic #803) — Shane: "Right clicking on an epic that
            // does NOT have a chat associated should allow me to create a new
            // chat and associate it to that Epic. Right clicking on an Epic
            // with a chat should allow me to open that Epic's chat." This
            // replicates the browser extension's openNewEpicChat /
            // tryInsertPrefillFromUrl (content.js) into BuildConsole's own
            // WebView2 tabs — the extension isn't installed there. Only epics
            // get this menu item; a plain issue's chat is already reached by the
            // existing In-Flight-click / ChatsTree paths (FindChatForIssue).
            // 2. Easy New Chat, any issue level.
            {
                var issueType = issue.IsEpic ? "Epic" : "Issue";
                var linkedChat = FindChatForIssue(issue.IssueNumber);
                if (linkedChat != null && !string.IsNullOrEmpty(linkedChat.ClaudeUrl))
                {
                    var chatUrl = linkedChat.ClaudeUrl;
                    var miOpenChat = new MenuItem { Header = "💬 Open Chat" };
                    miOpenChat.Click += (s, e) =>
                    {
                        ActivityLog.Log("git-board.chat", $"open linked chat for issue #{issue.IssueNumber} -> {chatUrl}");
                        EpicChatRequested?.Invoke(this, (chatUrl, $"#{issue.IssueNumber} Chat", false, null, issueType, issue.RawTitle));
                    };
                    cm.Items.Add(miOpenChat);
                }
                else
                {
                    var miNewChat = new MenuItem { Header = "➕ New Chat" };
                    miNewChat.Click += (s, e) =>
                    {
                        var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                        if (!settings.HasEpicChatProjectUrl)
                        {
                            ActivityLog.Log("git-board.chat", $"new chat for issue #{issue.IssueNumber} aborted — no New Chat Project URL configured");
                            ToastEngine.Warning("New Chat", "Set a \"New Chat Project URL\" in the Settings tab first.");
                            return;
                        }
                        var baseUrl = settings.EpicChatProjectUrl.Trim();
                        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out _))
                        {
                            ActivityLog.Log("git-board.chat", $"new chat for issue #{issue.IssueNumber} aborted — invalid New Chat Project URL '{baseUrl}'");
                            ToastEngine.Warning("New Chat", "The configured New Chat Project URL isn't a valid URL.");
                            return;
                        }
                        var pat = settings.GitHubPat?.Trim() ?? "";
                        var label = $"{issueType} #{issue.IssueNumber}";
                        var fullUrl = EpicChatUrlBuilder.BuildEpicChatUrl(baseUrl, pat, issue.IssueNumber, label: label);
                        ActivityLog.Log("git-board.chat", $"new chat for issue #{issue.IssueNumber} -> {baseUrl} (prefill '{label}', PAT {(string.IsNullOrEmpty(pat) ? "absent" : "present")})");
                        EpicChatRequested?.Invoke(this, (fullUrl, $"#{issue.IssueNumber} New Chat", true, issue.IssueNumber, issueType, $"[#{issue.IssueNumber}] {issue.RawTitle}"));
                    };
                    cm.Items.Add(miNewChat);
                }

                var miAssignChat = new MenuItem { Header = "🔗 Assign Chat to Issue..." };
                miAssignChat.Click += async (s, e) =>
                {
                    if (_api == null || !_api.IsConfigured)
                    {
                        ToastEngine.Warning("Assign Chat to Issue", "Build Tracker API isn't configured.");
                        return;
                    }

                    var existingChat = FindChatForIssue(issue.IssueNumber);
                    var dialog = new AssignChatToEpicDialog($"Issue #{issue.IssueNumber}", existingChat?.ClaudeUrl, GetActiveChatUrl);
                    if (dialog.ShowDialog() != true || string.IsNullOrWhiteSpace(dialog.ResultChatUrl)) return;
                    var chatUrl = dialog.ResultChatUrl.Trim();

                    var convMatch = System.Text.RegularExpressions.Regex.Match(
                        chatUrl, @"/chat/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})");
                    if (!convMatch.Success)
                    {
                        ActivityLog.Log("git-board.assign-chat", $"assign chat to issue #{issue.IssueNumber} aborted — '{chatUrl}' has no recognizable /chat/<uuid> conversation id");
                        ToastEngine.Warning("Assign Chat to Issue", "That doesn't look like a chat URL (expected .../chat/<uuid>).");
                        return;
                    }
                    var conversationId = convMatch.Groups[1].Value;

                    try
                    {
                        bool resolved = true;
                        if (_db != null)
                        {
                            resolved = await _db.LinkChatToIssueAsync(conversationId, issue.IssueNumber, $"[#{issue.IssueNumber}] {issue.RawTitle}", resolveLive: ResolveLiveBoardIssue);
                        }
                        else
                        {
                            var res = await _api.LinkChatToIssueAsync(conversationId, issue.IssueNumber, $"[#{issue.IssueNumber}] {issue.RawTitle}");
                            if (!res.IsSuccessStatusCode)
                            {
                                var body = await res.Content.ReadAsStringAsync();
                                ActivityLog.Log("git-board.assign-chat", $"assign chat {conversationId} -> issue #{issue.IssueNumber} FAILED: HTTP {(int)res.StatusCode} {body}");
                                ToastEngine.Error("Assign Chat to Issue", $"Couldn't assign: {body}");
                                return;
                            }
                        }
                        ActivityLog.Log("git-board.assign-chat", $"assigned chat {conversationId} ({chatUrl}) -> issue #{issue.IssueNumber}");
                        // Git #2068 — issue.IssueNumber is always a real board issue/epic here (this
                        // menu is only ever built from a real tree node), so an unresolved link IS a
                        // genuine problem worth surfacing, unlike the milestone-assign path above.
                        if (_db != null && !resolved)
                        {
                            ToastEngine.Warning("Assign Chat to Issue", $"Chat linked to #{issue.IssueNumber}, but it couldn't be grouped under its epic yet — try again after the Git Board refreshes.");
                            ActivityLog.Log("git-board.assign-chat", $"assigned chat {conversationId} -> issue #{issue.IssueNumber} via bt_chat_issues only — epic/issue FK resolution failed (Git #2068)");
                        }

                        var targetChat = _lastBoardChats.FirstOrDefault(c => c.ConversationId == conversationId);
                        if (targetChat != null)
                        {
                            if (!targetChat.AssociatedIssueNumbers.Contains(issue.IssueNumber))
                            {
                                targetChat.AssociatedIssueNumbers.Add(issue.IssueNumber);
                            }
                            targetChat.ClaudeUrl = chatUrl;
                        }
                        else
                        {
                            _lastBoardChats.Add(new BoardChat
                            {
                                ConversationId = conversationId,
                                Title = $"[#{issue.IssueNumber}] {issue.RawTitle}",
                                ClaudeUrl = chatUrl,
                                AssociatedIssueNumbers = new List<int> { issue.IssueNumber },
                                // Git #1480 — see the milestone-assign optimistic add above.
                                Account = BuildConsole.Services.BuildConsoleSettings.CurrentAccountLabel(),
                            });
                        }

                        _lastBoardSignature = null;
                        PopulateChatsTree();
                    }
                    catch (Exception ex)
                    {
                        ActivityLog.Log("git-board.assign-chat", $"assign chat {conversationId} -> issue #{issue.IssueNumber} FAILED: {ex.Message}");
                        ToastEngine.Error("Assign Chat to Issue", $"Couldn't assign: {ex.Message}");
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

        #region Git #2061/#2081 — Git Board issue-hover quick-action popover
        // Replaces the old plain-tooltip "static summary card" on a Git Board issue row with a
        // state-aware popover: same status pill/title/snippet info, plus ONE contextual primary
        // action matching the issue's real associated build state. State → action mapping is
        // #2061's own confirmed table:
        //   Queued        -> Dispatch (Start Now semantics, respects the concurrency cap)
        //   In progress / In flight -> real progress bar (BuildProgressTracker, #2033) + Cancel/Stop
        //   Done          -> Open build
        //   Failed        -> Retry
        //   Has a question -> #2036 (Chats panel question/ask tracking) isn't built yet, so this
        //                      isn't distinctly detected; a running build always offers the same
        //                      inline-reply -> resume-session mechanism #2036 will eventually gate
        //                      behind real detection (graceful degrade, not a second implementation).
        //   Blocked       -> no build action; overridden by the #2081 relationship picture instead.
        // Actions are dispatched through the RequestDispatchBuild/RequestCancelOrStopBuild/
        // RequestRetryBuild/RequestReplyToBuild/RequestOpenBuildChat delegates (set by MainWindow to
        // BuildQueuePanel's Quick*Async wrappers — see BuildQueuePanel.xaml.cs) so this reuses the
        // exact same _watcher/_db calls as the right-click menu's Cancel/Retry/Reply/Start Now
        // (#2030's inventory) instead of a second implementation.
        //
        // Git #2081 — every OPEN issue's popup (blocked or not) now also carries the full
        // relationship picture, both directions: what blocks it (GetBlockedByAsync, ALL declared
        // blockers with real titles, not just the sweep's cached first-open one) and — new — what
        // IT blocks (GetBlockingAsync, the reverse). No reverse lookup existed anywhere in the app
        // before this (checked #2030's Build Queue chain-highlight work: not landed, no bookend).
        // GitHub's real issue-dependencies REST API turned out to already mirror `blocked_by` with
        // a genuine `blocking` endpoint, confirmed live via `gh api .../dependencies/blocking` —
        // one REST call per issue, not a scan over every open issue's own blocked_by. Fetched live
        // on hover (LoadIssueRelationshipsAsync) rather than added to the periodic board sweep,
        // since it's popup-only data, not something every row's badge needs.

        private static readonly TimeSpan IssueHoverShowDelay = TimeSpan.FromMilliseconds(350);
        private static readonly TimeSpan IssueHoverHideDelay = TimeSpan.FromMilliseconds(250);
        private DispatcherTimer? _issueHoverShowTimer;
        private DispatcherTimer? _issueHoverHideTimer;
        private bool _issueHoverPointerInsidePopup;

        private void ScheduleIssueHoverShow(GitIssue issue, FrameworkElement target)
        {
            CancelIssueHoverHide();
            _issueHoverShowTimer?.Stop();
            _issueHoverShowTimer = new DispatcherTimer { Interval = IssueHoverShowDelay };
            _issueHoverShowTimer.Tick += (s, e) =>
            {
                _issueHoverShowTimer?.Stop();
                ShowIssueHoverPopup(issue, target);
            };
            _issueHoverShowTimer.Start();
        }

        private void CancelIssueHoverShow()
        {
            _issueHoverShowTimer?.Stop();
            _issueHoverShowTimer = null;
        }

        private void ScheduleIssueHoverHide()
        {
            CancelIssueHoverShow();
            _issueHoverHideTimer?.Stop();
            _issueHoverHideTimer = new DispatcherTimer { Interval = IssueHoverHideDelay };
            _issueHoverHideTimer.Tick += (s, e) =>
            {
                _issueHoverHideTimer?.Stop();
                if (!_issueHoverPointerInsidePopup)
                    HideIssueHoverPopup();
            };
            _issueHoverHideTimer.Start();
        }

        private void CancelIssueHoverHide()
        {
            _issueHoverHideTimer?.Stop();
            _issueHoverHideTimer = null;
        }

        private void IssueHoverPopup_MouseEnter(object sender, MouseEventArgs e)
        {
            _issueHoverPointerInsidePopup = true;
            CancelIssueHoverHide();
        }

        private void IssueHoverPopup_MouseLeave(object sender, MouseEventArgs e)
        {
            _issueHoverPointerInsidePopup = false;
            ScheduleIssueHoverHide();
        }

        private void IssueHoverPopup_Opened(object sender, EventArgs e) { }

        private void IssueHoverPopup_Closed(object sender, EventArgs e)
        {
            IssueHoverPopupBody.Children.Clear();
        }

        private void HideIssueHoverPopup()
        {
            _issueHoverPopupGeneration++;
            if (IssueHoverPopup.IsOpen) IssueHoverPopup.IsOpen = false;
        }

        /// <summary>Git #2081 — bumped on every show so a slow in-flight
        /// <see cref="LoadIssueRelationshipsAsync"/> fetch from a PREVIOUSLY hovered issue can
        /// detect it's stale (user moved to a different row, or the popup closed) and no-op
        /// instead of overwriting the current popup's content with the wrong issue's data.</summary>
        private int _issueHoverPopupGeneration;

        private void ShowIssueHoverPopup(GitIssue issue, FrameworkElement target)
        {
            IssueHoverPopupBody.Children.Clear();
            int generation = ++_issueHoverPopupGeneration;
            IssueHoverPopupBody.Children.Add(BuildIssueHoverPopupContent(issue, generation));
            IssueHoverPopup.PlacementTarget = target;
            IssueHoverPopup.IsOpen = true;
        }

        /// <summary>Same lookup GitDetailView.LoadIssue already does for its embedded build pane
        /// (most-recently-updated QueueItem whose GithubNumber matches) — reused here via the
        /// cheap in-memory GetQueueItems delegate instead of a fresh DB/API round trip.
        /// Git #2080 — internal (not private) so MainWindow/FloatingChatWindow's chat-mention
        /// hover popup can reuse this exact lookup via <see cref="BuildChatMentionActionPayload"/>
        /// instead of a second implementation.</summary>
        internal QueueItem? FindAssociatedBuild(int issueNumber)
        {
            var items = GetQueueItems?.Invoke() ?? Array.Empty<QueueItem>();
            return items
                .Where(i => i.GithubNumber == issueNumber)
                .OrderByDescending(i => i.UpdatedAt ?? DateTimeOffset.MinValue)
                .FirstOrDefault();
        }

        private UIElement BuildIssueHoverPopupContent(GitIssue issue, int generation)
        {
            var root = new StackPanel();
            bool isClosed = issue.Status == "CLOSED";

            var headerRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            headerRow.Children.Add(new Border
            {
                Background = isClosed ? GetBrush("GreenBrush") : GetBrush("BlueBrush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(0, 0, 6, 0),
                Child = new TextBlock { Text = isClosed ? "CLOSED" : "OPEN", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = Brushes.Black }
            });
            headerRow.Children.Add(new TextBlock { Text = $"#{issue.IssueNumber}", FontWeight = FontWeights.Bold, Foreground = GetBrush("PeachBrush") });
            root.Children.Add(headerRow);

            root.Children.Add(new TextBlock
            {
                Text = issue.Title,
                FontWeight = FontWeights.SemiBold,
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
                Foreground = GetBrush("TextBrush"),
                Margin = new Thickness(0, 0, 0, 4)
            });

            if (!string.IsNullOrWhiteSpace(issue.Body))
            {
                string snippet = issue.Body.Replace("\r", " ").Replace("\n", " ").Trim();
                if (snippet.Length > 160) snippet = snippet.Substring(0, 160).TrimEnd() + "…";
                root.Children.Add(new TextBlock
                {
                    Text = snippet,
                    FontSize = 10,
                    Foreground = GetBrush("Subtext0Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 0, 0, 8)
                });
            }

            // Git #2081 — the full relationship picture (blocked-by AND the reverse "what this
            // blocks" direction, both with real titles), not just #2061's single-line "waiting
            // on #N" fallback. Fetched live on hover (GitHub's real dependencies API, both
            // directions) since the periodic board sweep only ever cached the first still-open
            // blocker for the badge. Seeded synchronously below from that cached field so a
            // blocked issue isn't blank while the live fetch is in flight.
            if (!isClosed)
            {
                var relPanel = new StackPanel { Margin = new Thickness(0, 0, 0, 8) };
                if (issue.IsBlocked && issue.BlockedByNumber.HasValue)
                {
                    relPanel.Children.Add(new TextBlock
                    {
                        Text = $"🔒 Waiting on #{issue.BlockedByNumber} — {issue.BlockedByTitle}",
                        FontSize = 11,
                        Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")),
                        TextWrapping = TextWrapping.Wrap,
                        Margin = new Thickness(0, 0, 0, 2)
                    });
                }
                root.Children.Add(relPanel);
                _ = LoadIssueRelationshipsAsync(issue, relPanel, generation);
            }

            // Blocked overrides any build-state action, same precedence GitDetailView/CreateIssueHeader
            // already use for the blocked dot/banner elsewhere on this row.
            if (!isClosed && issue.IsBlocked)
            {
                return root;
            }

            var build = FindAssociatedBuild(issue.IssueNumber);
            if (build == null)
            {
                // Git #2063 — this used to show nothing at all: no tracked build row exists
                // for this issue, so DispatchPanel's own "No build prompt found" dead-end had
                // no equivalent here either. Same fix, same target: dispatch it if a BUILD:
                // comment already exists, else ask the currently active chat to write one.
                root.Children.Add(new Separator { Margin = new Thickness(0, 2, 0, 6) });
                root.Children.Add(MakeQuickActionButton("⚡ Dispatch (asks active chat if no BUILD: yet)", async () =>
                    await DispatchOrAskActiveChatAsync(issue)));
                return root;
            }

            root.Children.Add(new Separator { Margin = new Thickness(0, 2, 0, 6) });
            root.Children.Add(BuildQuickActionArea(build));
            return root;
        }

        /// <summary>
        /// Git #2081 — the real "full relationship picture": live-fetches BOTH directions of
        /// GitHub's issue-dependencies API for this issue — <see cref="GitHubApiClient.GetBlockedByAsync"/>
        /// (what blocks it, ALL declared blockers not just the sweep's cached first-open one) and
        /// the new <see cref="GitHubApiClient.GetBlockingAsync"/> (the reverse — what THIS issue
        /// blocks, which nothing else in the app computes yet; confirmed no #2030 chain-highlight
        /// landed to reuse). Runs after the popup is already showing (hover popups can't block on
        /// network), so <paramref name="generation"/> — captured at the moment this specific popup
        /// was shown — guards against a slow response from a PREVIOUSLY hovered issue landing in
        /// the CURRENTLY hovered issue's popup.
        /// </summary>
        private async System.Threading.Tasks.Task LoadIssueRelationshipsAsync(GitIssue issue, StackPanel container, int generation)
        {
            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return;

            List<GitHubIssueResult> blockedBy;
            List<GitHubIssueResult> blocking;
            try
            {
                var gh = new GitHubApiClient(settings.GitHubPat);
                var blockedByTask = gh.GetBlockedByAsync(issue.IssueNumber);
                var blockingTask = gh.GetBlockingAsync(issue.IssueNumber);
                await System.Threading.Tasks.Task.WhenAll(blockedByTask, blockingTask);
                blockedBy = blockedByTask.Result;
                blocking = blockingTask.Result;
            }
            catch
            {
                // Leave whatever was already seeded (the sweep's cached "waiting on #N" line, or
                // nothing) rather than replacing it with an error — this is a hover popup, not a
                // place to surface a network failure.
                return;
            }

            if (generation != _issueHoverPopupGeneration) return;
            if (!IssueHoverPopup.IsOpen) return;

            container.Children.Clear();
            AddRelationshipList(container, "🔒 Blocked by", blockedBy);
            AddRelationshipList(container, "⛔ Blocks", blocking);
        }

        /// <summary>Renders one capped, real-title relationship list (either direction) into the
        /// hover popup's relationships panel. Skips rendering entirely when empty — this is a
        /// real "nothing to show" case (an issue with no declared dependency in that direction),
        /// not a fixture/placeholder gap, so no "None" row is added.</summary>
        private void AddRelationshipList(StackPanel container, string label, List<GitHubIssueResult> items)
        {
            if (items == null || items.Count == 0) return;

            const int maxShown = 6;
            container.Children.Add(new TextBlock
            {
                Text = label,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = GetBrush("Subtext0Brush"),
                Margin = new Thickness(0, 4, 0, 2)
            });
            foreach (var item in items.Take(maxShown))
            {
                container.Children.Add(new TextBlock
                {
                    Text = $"#{item.Number} — {item.Title}",
                    FontSize = 10.5,
                    Foreground = item.IsClosed
                        ? GetBrush("Subtext0Brush")
                        : new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(6, 0, 0, 2)
                });
            }
            if (items.Count > maxShown)
            {
                container.Children.Add(new TextBlock
                {
                    Text = $"+{items.Count - maxShown} more",
                    FontSize = 9.5,
                    Foreground = GetBrush("Subtext0Brush"),
                    Margin = new Thickness(6, 0, 0, 4)
                });
            }
        }

        /// <summary>
        /// Git #2063 — the Git Board hover popover's no-tracked-build-row branch above mirrors
        /// DispatchPanel.DispatchAsync's own fetch+parse+queue path (not a second implementation
        /// of the parser or the queue insert): if a `BUILD:` comment already exists, queue it
        /// exactly as the Dispatch box would; if not, ask whatever chat is CURRENTLY ACTIVE (not
        /// necessarily the epic-linked chat — Shane just decided "this is ready" in some active
        /// chat right before hovering this card) to write and post one, via the same #2059
        /// send+submit bridge <see cref="MainWindow.SendToActiveChatAsync"/> wraps.
        /// Git #2080 — internal so the chat-mention popup's "no tracked build" action can call
        /// this exact same path instead of re-implementing it.
        /// </summary>
        internal async System.Threading.Tasks.Task DispatchOrAskActiveChatAsync(GitIssue issue)
        {
            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ToastEngine.Error("Dispatch", "No GitHub PAT configured — set one in Settings.");
                return;
            }

            var gh = new GitHubApiClient(settings.GitHubPat);
            var (rawComment, parsed) = await BatterUpQueueService.FindBuildCommentAsync(gh, issue.IssueNumber);

            if (rawComment == null || parsed == null)
            {
                var mainWindow = Application.Current.MainWindow as MainWindow;
                string askStatus = mainWindow != null
                    ? await mainWindow.SendToActiveChatAsync(ActiveChatBuildRequestHelper.BuildAskMessage(issue.IssueNumber, issue.Title))
                    : "no-active-chat";
                var (message, isError) = ActiveChatBuildRequestHelper.DescribeStatus(askStatus, issue.IssueNumber);
                if (isError) ToastEngine.Warning("Dispatch", message); else ToastEngine.Success("Dispatch", message);
                ActivityLog.Log("dispatch", $"Dispatch #{issue.IssueNumber} (Git Board) — ask-active-chat status: {askStatus}");
                return;
            }

            if (_db == null)
            {
                ToastEngine.Error("Dispatch", "Not connected to the build queue database.");
                return;
            }

            var (model, effort, buildSet, _, prompt) = parsed.Value;
            var existing = await _db.FindDedupCandidateAsync(issue.IssueNumber, prompt);
            if (existing != null)
            {
                ToastEngine.Info("Dispatch", $"#{issue.IssueNumber} is already tracked (status: {existing.Status}).");
                return;
            }

            var blockers = await gh.GetBlockedByAsync(issue.IssueNumber);
            var blockedByNumbers = blockers.Select(b => b.Number).ToList();

            await _db.QueueBuildAsync(
                title: issue.Title,
                prompt: prompt,
                model: model,
                effort: effort,
                cwd: null,
                githubNumber: issue.IssueNumber,
                blockedByNumbers: blockedByNumbers,
                buildSet: buildSet);

            ToastEngine.Success("Dispatch", $"#{issue.IssueNumber} \"{issue.Title}\" queued.");
            ActivityLog.Log("dispatch", $"Dispatch #{issue.IssueNumber} \"{issue.Title}\" (Git Board) — queued.");
        }

        private UIElement BuildQuickActionArea(QueueItem build)
        {
            // Git #2080 — status→action classification lives in the shared
            // IssueQuickActionResolver now (reused verbatim by the chat-mention popup's HTML
            // renderer via BuildChatMentionActionPayload below); this method only turns that
            // classification into WPF widgets.
            var panel = new StackPanel();
            var state = IssueQuickActionResolver.Resolve(build);

            Brush statusBrush = build.Status switch
            {
                "done" => GetBrush("GreenBrush"),
                "failed" => new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F38BA8")),
                _ => GetBrush("Subtext0Brush")
            };
            panel.Children.Add(new TextBlock { Text = state.StatusText, FontSize = 11, Foreground = statusBrush, Margin = new Thickness(0, 0, 0, 6) });

            if (build.Status == "running")
            {
                if (state.ProgressPercent.HasValue)
                {
                    panel.Children.Add(new ProgressBar { Minimum = 0, Maximum = 100, Value = state.ProgressPercent.Value, Height = 8, Margin = new Thickness(0, 0, 0, 4) });
                    panel.Children.Add(new TextBlock
                    {
                        Text = state.ProgressLabel,
                        FontSize = 10,
                        Foreground = GetBrush("Subtext0Brush"),
                        TextWrapping = TextWrapping.Wrap,
                        Margin = new Thickness(0, 0, 0, 6)
                    });
                    if (state.IsStale)
                    {
                        panel.Children.Add(new TextBlock { Text = "⚠ " + state.StalenessText, FontSize = 10, Foreground = GetBrush("PeachBrush"), Margin = new Thickness(0, 0, 0, 6) });
                    }
                }
            }

            panel.Children.Add(MakeQuickActionButton(state.ActionLabel, () => DispatchQuickAction(state.ActionKind, build)));

            if (state.AllowReply)
            {
                panel.Children.Add(BuildInlineReplyBox(build));
            }

            return panel;
        }

        /// <summary>Executes an <see cref="IssueQuickActionKind"/> resolved by
        /// <see cref="IssueQuickActionResolver"/> through the exact same
        /// RequestDispatchBuild/RequestCancelOrStopBuild/RequestRetryBuild/RequestOpenBuildChat
        /// delegates #2061 wired to BuildQueuePanel.Quick*Async — the single place both this
        /// popover's button and (indirectly, via BuildChatMentionActionPayload's ActionKind
        /// string) the chat-mention popup's BT_ISSUE_ACTION handler agree on what each kind
        /// means.</summary>
        private async System.Threading.Tasks.Task DispatchQuickAction(IssueQuickActionKind kind, QueueItem build)
        {
            switch (kind)
            {
                case IssueQuickActionKind.Dispatch:
                    if (RequestDispatchBuild != null) await RequestDispatchBuild(build);
                    break;
                case IssueQuickActionKind.Cancel:
                    if (RequestCancelOrStopBuild != null) await RequestCancelOrStopBuild(build);
                    break;
                case IssueQuickActionKind.Retry:
                    if (RequestRetryBuild != null) await RequestRetryBuild(build);
                    break;
                case IssueQuickActionKind.OpenBuild:
                case IssueQuickActionKind.OpenChat:
                    RequestOpenBuildChat?.Invoke(build);
                    break;
            }
        }

        /// <summary>
        /// Git #2080 — the chat-mention hover popup (IssueMentionInjector, HTML/JS in the
        /// claude.ai WebView2) needs the SAME state-aware action data as
        /// <see cref="BuildIssueHoverPopupContent"/> renders as WPF above, without a second
        /// implementation of the resolution: same blocked-overrides-build-state precedence, same
        /// <see cref="FindAssociatedBuild"/> lookup, same <see cref="IssueQuickActionResolver"/>
        /// classification. Returns a plain serializable payload; the WebView host
        /// (MainWindow/FloatingChatWindow) JSON-serializes it and hands it to the JS
        /// <c>__btShowIssueTip</c> callback, which renders HTML buttons that post a
        /// BT_ISSUE_ACTION message back — the actual Quick*Async calls happen host-side (see
        /// MainWindow.ChatWv_WebMessageReceived), reusing the exact same wrappers
        /// <see cref="DispatchQuickAction"/> uses, not a second execution path.
        /// </summary>
        internal ChatMentionActionPayload BuildChatMentionActionPayload(GitIssue issue)
        {
            bool isClosed = issue.Status == "CLOSED";

            if (!isClosed && issue.IsBlocked)
            {
                return new ChatMentionActionPayload
                {
                    Blocked = new ChatMentionBlocked { Number = issue.BlockedByNumber, Title = issue.BlockedByTitle }
                };
            }

            var build = FindAssociatedBuild(issue.IssueNumber);
            if (build == null)
            {
                return new ChatMentionActionPayload { NoBuildDispatch = true };
            }

            var state = IssueQuickActionResolver.Resolve(build);
            return new ChatMentionActionPayload
            {
                Build = new ChatMentionBuild
                {
                    Id = build.Id,
                    StatusText = state.StatusText,
                    ActionKind = state.ActionKind.ToString().ToLowerInvariant(),
                    ActionLabel = state.ActionLabel,
                    AllowReply = state.AllowReply,
                    ProgressPercent = state.ProgressPercent,
                    ProgressLabel = state.ProgressLabel,
                    Stale = state.IsStale,
                    StaleText = state.StalenessText
                }
            };
        }

        private Button MakeQuickActionButton(string label, Func<System.Threading.Tasks.Task> onClick)
        {
            var btn = new Button { Content = label, Padding = new Thickness(8, 3, 8, 3), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 4) };
            btn.Click += async (s, e) =>
            {
                btn.IsEnabled = false;
                try { await onClick(); }
                finally { HideIssueHoverPopup(); }
            };
            return btn;
        }

        /// <summary>Graceful degrade for #2061's "Has a question -> inline answer field -> resume
        /// session" state: #2036 (the mechanism that would detect a specific pending question) isn't
        /// built yet, so this is always offered on a running build rather than gated behind
        /// detection that doesn't exist. Sends through the same resume-session path as the
        /// right-click menu's "Reply..." item (BuildQueuePanel.QuickReplyAsync); that method already
        /// no-ops with a toast if the build has no captured session id yet.</summary>
        private UIElement BuildInlineReplyBox(QueueItem build)
        {
            var wrap = new StackPanel { Margin = new Thickness(0, 4, 0, 0) };
            var box = new TextBox
            {
                FontSize = 10,
                Padding = new Thickness(4),
                Margin = new Thickness(0, 0, 0, 4),
                TextWrapping = TextWrapping.Wrap,
                AcceptsReturn = false
            };
            const string replyPlaceholder = "Reply and resume this session…";
            TextBoxHelper_SetPlaceholder(box, replyPlaceholder);
            var sendBtn = new Button { Content = "💬 Send Reply", Padding = new Thickness(8, 3, 8, 3), HorizontalAlignment = HorizontalAlignment.Left };
            sendBtn.Click += async (s, e) =>
            {
                var message = box.Text?.Trim();
                if (string.IsNullOrWhiteSpace(message) || message == replyPlaceholder) return;
                sendBtn.IsEnabled = false;
                try
                {
                    if (RequestReplyToBuild != null) await RequestReplyToBuild(build, message);
                }
                finally
                {
                    HideIssueHoverPopup();
                }
            };
            wrap.Children.Add(box);
            wrap.Children.Add(sendBtn);
            return wrap;
        }

        /// <summary>No dedicated watermark/placeholder control exists in this codebase's WPF
        /// controls — a minimal focus-swap placeholder so the reply box isn't blank with no hint.</summary>
        private void TextBoxHelper_SetPlaceholder(TextBox box, string placeholder)
        {
            box.Text = placeholder;
            box.Foreground = GetBrush("Subtext0Brush");
            box.GotFocus += (s, e) =>
            {
                if (box.Text == placeholder)
                {
                    box.Text = "";
                    box.Foreground = GetBrush("TextBrush");
                }
            };
            box.LostFocus += (s, e) =>
            {
                if (string.IsNullOrWhiteSpace(box.Text))
                {
                    box.Text = placeholder;
                    box.Foreground = GetBrush("Subtext0Brush");
                }
            };
        }

        #endregion

        private static TreeViewItem? FindIssueTreeViewItem(ItemCollection items, int issueNumber)
        {
            foreach (var item in items)
            {
                if (item is TreeViewItem tvi)
                {
                    if (tvi.Tag is GitIssue gi && gi.IssueNumber == issueNumber)
                        return tvi;
                    var child = FindIssueTreeViewItem(tvi.Items, issueNumber);
                    if (child != null) return child;
                }
            }
            return null;
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

            var gitIssue = new GitIssue
            {
                IssueNumber = result.Number,
                Title = result.Title,
                RawTitle = result.Title,
                Status = result.IsClosed ? "CLOSED" : "OPEN",
                IsBlocked = blocked,
                IsComplete = result.Labels.Any(l => string.Equals(l.Name, "complete", StringComparison.OrdinalIgnoreCase)),
                IsInFlight = result.HasInFlightLabel,
                Labels = result.Labels,
            };

            var tvi = new TreeViewItem { Header = p, Tag = gitIssue };
            tvi.MouseLeftButtonUp += (s, e) =>
            {
                IssueSelected?.Invoke(this, gitIssue);
                GitDetailTabRequested?.Invoke(this, gitIssue);
            };

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
        // Git #1968 — raised from 750ms as a SUPPLEMENT only, not the fix: the
        // real fix is excluding the actual churn source (IsIgnorableGitInternalPath)
        // and the no-op gates below. A longer debounce on a watcher that never goes
        // quiet just slows a broken loop down; it doesn't stop one. This only
        // reduces cadence for genuine bursts (a large real commit/pull/checkout
        // touching many files at once) that legitimately still need to coalesce.
        private static readonly TimeSpan GitWatcherDebounceDelay = TimeSpan.FromMilliseconds(1500);

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
        ///
        /// Git #1968 — diagnosed with a real FileSystemWatcher probe (same
        /// Path/IncludeSubdirectories/NotifyFilter as SetupGitWatcher below,
        /// run directly against the live RootWorkspacePath while a real
        /// BuildConsole session was active) rather than assuming the issue's
        /// build-output/node_modules hypothesis: the actual, dominant,
        /// continuous churn (217 events in one 30s sample) was almost
        /// entirely writes to &lt;root&gt;/.logs/activity-&lt;date&gt;.log and
        /// .logs/activity-latest.log — ActivityLog.cs's own WorkspaceLogDir
        /// sink, which every ActivityLog.Log() call anywhere in the app
        /// (queue polling, version checks, and this very panel's own
        /// "rendered N commit(s)" line) appends to. That sits INSIDE the
        /// watched tree, so it's a self-sustaining loop even in an
        /// otherwise-idle session: this panel's own render writes a log
        /// line, which re-fires the watcher, which re-arms the debounce,
        /// which triggers the next render. Excluded here for the same
        /// reason .git/objects and .git/logs are — the app's own
        /// bookkeeping, not a real workspace change worth refreshing on.
        /// </summary>
        private static bool IsIgnorableGitInternalPath(string fullPath)
        {
            string normalized = fullPath.Replace('\\', '/');

            if (normalized.IndexOf("/.logs/", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;

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

        // Git #1968 — the raw `git status --porcelain -b` text from the last
        // refresh that actually rebuilt GitChangesTree. `git status` still has to
        // run every time (it's the cheapest available signal that anything
        // working-tree-visible changed at all), but a repeated refresh whose
        // output is byte-identical to last time skips the expensive part: the
        // Clear()+rebuild of the staged/unstaged TreeViewItem visual tree.
        private string? _lastGitStatusRawOutput;

        // Git #2535 — thin fire-and-forget wrapper kept for the many void call sites
        // (BtnGitRefresh_Click, the FileSystemWatcher debounce, MainWindow, etc.).
        // The real body is now awaitable so RunGitCommand can await it and then set a
        // command-result message that wins over the summary this writes at its tail.
        public async void RefreshGitStatus() => await RefreshGitStatusAsync();

        private async System.Threading.Tasks.Task RefreshGitStatusAsync()
        {
            _gitStatusLoadingTimer?.Dispose();
            _gitStatusLoadingTimer = new System.Threading.Timer(_ =>
            {
                Dispatcher.Invoke(() => GitStatusSummaryText.Text = "REFRESHING GIT STATUS...");
            }, null, TimeSpan.FromSeconds(30), System.Threading.Timeout.InfiniteTimeSpan);

            var (branch, stagedItems, unstagedItems, rawOutput) = await System.Threading.Tasks.Task.Run(() =>
            {
                string b = "main";
                var staged = new List<GitItem>();
                var unstaged = new List<GitItem>();
                string rawOut = "";

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
                        rawOut = output;

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

                return (b, staged, unstaged, rawOut);
            });

            _gitStatusLoadingTimer?.Dispose();
            _gitStatusLoadingTimer = null;

            // Git #1968 — genuine no-op: an unchanged porcelain status means the
            // Changes tree we already have on screen is still byte-for-byte
            // correct, so skip tearing it down and rebuilding it from scratch.
            bool statusUnchanged = _lastGitStatusRawOutput != null && rawOutput == _lastGitStatusRawOutput;
            _lastGitStatusRawOutput = rawOutput;

            if (!statusUnchanged)
            {
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
            }

            // Git #860 (Git panel Phase 2) — the rendered commit graph lives in
            // the same scrollable panel below Changes; refresh it from the same
            // trigger so both sections stay in sync (view-switch, manual
            // refresh, own commit/push/pull, and #859's FileSystemWatcher).
            // Git #1968 — PopulateGitGraph now gates its own work (collapsed
            // skip + its own process-free no-op signature), independent of
            // statusUnchanged above, since a real commit can land with no
            // working-tree-visible status change (e.g. no upstream tracking).
            PopulateGitGraph();

            // Git #1898 — the real branch list refreshes off the same trigger too.
            PopulateGitBranches();
        }

        /// <summary>Git #1898 — collapses/expands the rendered commit graph. Shane: "I never use
        /// the commit graph, I want it out of the way" — collapsed by default (see XAML
        /// IsChecked="True").
        /// Git #1968 — PopulateGitGraph no longer does any work while collapsed (it was
        /// spawning `git log` + rebuilding the whole swimlane visual tree on every
        /// RefreshGitStatus cycle regardless of whether anyone could see it). Expanding is
        /// now the trigger that fetches it, so "latest data immediately on expand" still
        /// holds — just from a fresh fetch here instead of one that silently already ran
        /// while hidden.</summary>
        private void BtnGitGraphToggle_Click(object sender, RoutedEventArgs e)
        {
            bool collapsed = BtnGitGraphToggle.IsChecked == true;
            GitGraphHost.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;

            if (!collapsed)
            {
                PopulateGitGraph();
            }
        }

        /// <summary>Git #1898 — collapses/expands the real branch list. Collapsed by default,
        /// same convention as BtnGitGraphToggle above.</summary>
        private void BtnGitBranchesToggle_Click(object sender, RoutedEventArgs e)
        {
            bool collapsed = BtnGitBranchesToggle.IsChecked == true;
            GitBranchListHost.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
        }

        /// <summary>
        /// Git #1898 — fetches the repo's real local + remote-tracking branches (`git branch -a`)
        /// and renders them into GitBranchListHost. Runs the (blocking) git call on a worker
        /// thread, same pattern as PopulateGitGraph. The current branch is marked with a filled
        /// dot; a local (non-current) branch checks out on click via the existing RunGitCommand
        /// pipeline, which already re-refreshes the whole panel afterward.
        /// </summary>
        public void PopulateGitBranches()
        {
            System.Threading.Tasks.Task.Run(() =>
            {
                var branches = new List<(string Name, bool IsCurrent, bool IsRemote)>();
                try
                {
                    var psi = new System.Diagnostics.ProcessStartInfo
                    {
                        FileName = "git",
                        Arguments = "branch -a --no-color",
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

                        foreach (var raw in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                        {
                            string line = raw.TrimEnd('\r');
                            bool isCurrent = line.StartsWith("*");
                            string name = line.TrimStart('*', ' ').Trim();
                            if (name.Length == 0 || name.Contains("->")) continue; // skip "origin/HEAD -> origin/main" alias rows
                            bool isRemote = name.StartsWith("remotes/");
                            if (isRemote) name = name.Substring("remotes/".Length);
                            branches.Add((name, isCurrent, isRemote));
                        }
                    }
                }
                catch { }

                return branches;
            }).ContinueWith(t =>
            {
                var branches = t.Result;
                Dispatcher.Invoke(() =>
                {
                    GitBranchListHost.Children.Clear();

                    if (branches.Count == 0)
                    {
                        GitBranchListHost.Children.Add(new TextBlock
                        {
                            Text = "No branches found.",
                            FontSize = 11,
                            Foreground = GetBrush("Subtext0Brush")
                        });
                        return;
                    }

                    foreach (var b in branches)
                    {
                        var row = new DockPanel { LastChildFill = false, Margin = new Thickness(0, 2, 0, 2) };
                        var sp = new StackPanel { Orientation = Orientation.Horizontal };
                        sp.Children.Add(new TextBlock
                        {
                            Text = b.IsCurrent ? "● " : "○ ",
                            FontSize = 10,
                            Foreground = b.IsCurrent ? GetBrush("GreenBrush") : GetBrush("Subtext0Brush"),
                            VerticalAlignment = VerticalAlignment.Center
                        });
                        sp.Children.Add(new TextBlock
                        {
                            Text = b.Name,
                            FontSize = 11,
                            FontWeight = b.IsCurrent ? FontWeights.Bold : FontWeights.Normal,
                            Foreground = b.IsRemote ? GetBrush("Subtext1Brush") : GetBrush("TextBrush"),
                            VerticalAlignment = VerticalAlignment.Center,
                            ToolTip = b.IsRemote ? "Remote-tracking branch" : (b.IsCurrent ? "Current branch" : "Local branch — double-click to check out")
                        });
                        DockPanel.SetDock(sp, Dock.Left);
                        row.Children.Add(sp);

                        if (!b.IsCurrent && !b.IsRemote)
                        {
                            row.Cursor = Cursors.Hand;
                            string branchName = b.Name;
                            row.MouseLeftButtonUp += (s, e) => _ = RunGitCommand($"checkout \"{branchName}\"");
                        }

                        GitBranchListHost.Children.Add(row);
                    }
                });
            });
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
                miUnstage.Click += (s, e) => _ = RunGitCommand($"restore --staged \"{item.RelativePath}\"");
                cm.Items.Add(miUnstage);
            }
            else
            {
                var miStage = new MenuItem { Header = "Stage Change (+)" };
                miStage.Click += (s, e) => _ = RunGitCommand($"add \"{item.RelativePath}\"");
                cm.Items.Add(miStage);

                var miDiscard = new MenuItem { Header = "Discard Changes (↩)" };
                miDiscard.Click += (s, e) => _ = RunGitCommand($"checkout -- \"{item.RelativePath}\"");
                cm.Items.Add(miDiscard);
            }

            var miOpen = new MenuItem { Header = "Open File" };
            miOpen.Click += (s, e) => FileSelected?.Invoke(this, item.FilePath);
            cm.Items.Add(miOpen);

            cm.Items.Add(new Separator());

            // Git #1898 — right-click "Add to .gitignore" on any Changes entry.
            var miGitignore = new MenuItem { Header = "Add to .gitignore" };
            miGitignore.Click += (s, e) => AddToGitignore(item);
            cm.Items.Add(miGitignore);

            tvi.ContextMenu = cm;
            return tvi;
        }

        /// <summary>
        /// Git #1898 — appends <paramref name="item"/>'s real repo-relative path to the repo's
        /// .gitignore (creating the file if it doesn't exist yet). A file git already tracks
        /// (staged, or a working-tree change to a tracked file — i.e. anything whose
        /// StatusLetter isn't the untracked "U") won't actually disappear from `git status` just
        /// because it's now in .gitignore, per the issue's required distinction — so that case
        /// warns explicitly instead of silently claiming the file is now ignored.
        /// </summary>
        private void AddToGitignore(GitItem item)
        {
            try
            {
                string gitignorePath = System.IO.Path.Combine(RootWorkspacePath, ".gitignore");
                string relPath = item.RelativePath.Replace('\\', '/');

                string[] existingLines = System.IO.File.Exists(gitignorePath)
                    ? System.IO.File.ReadAllLines(gitignorePath)
                    : Array.Empty<string>();

                if (existingLines.Any(l => l.Trim() == relPath))
                {
                    GitStatusSummaryText.Text = $"{relPath} is already in .gitignore";
                    return;
                }

                bool needsLeadingNewline = existingLines.Length > 0 && !string.IsNullOrEmpty(existingLines[^1]);
                string toAppend = (needsLeadingNewline ? Environment.NewLine : "") + relPath + Environment.NewLine;
                System.IO.File.AppendAllText(gitignorePath, toAppend);

                bool isTracked = item.IsStaged || item.StatusLetter != "U";
                GitStatusSummaryText.Text = isTracked
                    ? $"Added {relPath} to .gitignore — it's already tracked by git, so it'll keep showing as changed until you 'git rm --cached' it"
                    : $"Added {relPath} to .gitignore";

                ActivityLog.Log("git-panel.gitignore", $"added '{relPath}' to .gitignore (already tracked: {isTracked})");
                RefreshGitStatus();
            }
            catch (Exception ex)
            {
                GitStatusSummaryText.Text = $"Failed to update .gitignore: {ex.Message}";
            }
        }

        /// <summary>
        /// Git #2535 — runs a git mutation (commit/push/pull/add/restore/checkout) and
        /// SURFACES the real result. Before this, stdout/stderr were redirected but never
        /// read, the exit code was never checked, and the whole thing sat in an empty
        /// `catch {}` — so every commit/push that actually failed (nothing staged, a hook
        /// rejection, a non-fast-forward push, an auth/network error) looked identical to
        /// one that succeeded. Now: both streams are drained (before WaitForExit, to avoid
        /// a full-pipe deadlock), the exit code decides success vs failure, and git's own
        /// message is shown in <see cref="GitStatusSummaryText"/> — with the full raw
        /// output on its ToolTip. Returns true only on a genuine zero-exit result.
        /// </summary>
        private async System.Threading.Tasks.Task<bool> RunGitCommand(string args)
        {
            GitStatusSummaryText.Text = $"RUNNING: git {args}...";
            GitStatusSummaryText.ToolTip = null;

            var (exitCode, stdout, stderr, launchError) = await System.Threading.Tasks.Task.Run(() =>
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
                    if (p == null)
                        return (-1, "", "", (string?)"git process failed to start");
                    // Drain both streams before WaitForExit: a full stdout/stderr pipe
                    // buffer would otherwise deadlock a process we're only WaitForExit-ing.
                    string outText = p.StandardOutput.ReadToEnd();
                    string errText = p.StandardError.ReadToEnd();
                    p.WaitForExit();
                    return (p.ExitCode, outText, errText, (string?)null);
                }
                catch (Exception ex)
                {
                    return (-1, "", "", (string?)ex.Message);
                }
            });

            // Rebuild the Changes tree first, THEN set the result message so it wins over
            // the "STAGED (n) • CHANGES (m)" summary RefreshGitStatusAsync writes at its tail.
            await RefreshGitStatusAsync();

            string full = ($"{stdout}\n{stderr}").Trim();
            GitStatusSummaryText.ToolTip = string.IsNullOrWhiteSpace(full) ? null : full;

            if (launchError != null)
            {
                GitStatusSummaryText.Text = $"✗ git {args} — {launchError}";
                try { ActivityLog.Log("git-panel.error", $"git {args} could not run: {launchError}"); } catch { }
                return false;
            }

            if (exitCode == 0)
            {
                // Success summary from stdout only — commit/pull put the useful line there
                // ("[branch hash] msg", "Already up to date."), while add/push emit only
                // CRLF/progress noise to stderr that shouldn't masquerade as the result.
                string ok = BestGitLine(stdout, "");
                GitStatusSummaryText.Text = string.IsNullOrEmpty(ok)
                    ? $"✓ git {args} succeeded"
                    : $"✓ {ok}";
                try { ActivityLog.Log("git-panel.ok", $"git {args} succeeded (exit 0)"); } catch { }
                return true;
            }

            string err = BestGitLine(stderr, stdout);
            if (string.IsNullOrEmpty(err)) err = $"exit code {exitCode}";
            GitStatusSummaryText.Text = $"✗ git {args} failed — {err}";
            try { ActivityLog.Log("git-panel.error", $"git {args} failed (exit {exitCode}): {err}"); } catch { }
            return false;
        }

        /// <summary>
        /// Git #2535 — picks the single most informative line from git's output for the
        /// one-line status summary: an explicit fatal/error/rejected/no-op line if present,
        /// otherwise the first substantive line (skipping warning:/hint: noise).
        /// <paramref name="primary"/> is searched
        /// before <paramref name="secondary"/> (stdout-first for success, stderr-first for
        /// failure). Full raw output is preserved on the ToolTip by the caller.
        /// </summary>
        private static string BestGitLine(string primary, string secondary)
        {
            var lines = new List<string>();
            foreach (var src in new[] { primary, secondary })
            {
                if (string.IsNullOrWhiteSpace(src)) continue;
                foreach (var raw in src.Split('\n'))
                {
                    string t = raw.Trim();
                    if (t.Length > 0) lines.Add(t);
                }
            }
            if (lines.Count == 0) return "";
            // 1) An explicit outcome line wins — the real reason a mutation failed or was a
            //    no-op, which is often not the first line git prints (e.g. "nothing to commit"
            //    comes after "On branch ...").
            foreach (var key in new[] { "fatal:", "error:", "rejected", "! [",
                                        "nothing to commit", "nothing added to commit", "no changes added" })
            {
                var hit = lines.FirstOrDefault(l => l.IndexOf(key, StringComparison.OrdinalIgnoreCase) >= 0);
                if (hit != null) return hit;
            }
            // 2) Otherwise the first substantive line, skipping pure noise (CRLF/hint chatter).
            var substantive = lines.FirstOrDefault(l =>
                !l.StartsWith("warning:", StringComparison.OrdinalIgnoreCase) &&
                !l.StartsWith("hint:", StringComparison.OrdinalIgnoreCase));
            return substantive ?? lines[0];
        }

        private void BtnGitRefresh_Click(object sender, RoutedEventArgs e) => RefreshGitStatus();

        /// <summary>
        /// Git #2535 — bulk "Stage All". Before this, staging was per-file only via each
        /// row's right-click context menu; a multi-file check-in meant N right-clicks.
        /// `git add -A` stages every real change in one action — new, modified, and deleted
        /// tracked/untracked files alike — and its success/failure is surfaced like any
        /// other RunGitCommand.
        /// </summary>
        private async void BtnGitStageAll_Click(object sender, RoutedEventArgs e)
        {
            await RunGitCommand("add -A");
        }
        private void BtnGitPush_Click(object sender, RoutedEventArgs e) => _ = RunGitCommand("push");
        private void BtnGitPull_Click(object sender, RoutedEventArgs e) => _ = RunGitCommand("pull");

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

        // Git #1968 — the last ComputeGitGraphSignature() result the graph was
        // actually rendered from. Null until the first real render.
        private string? _lastGitGraphSignature;

        /// <summary>
        /// Git #1968 — a cheap, process-free signal for "has anything the commit graph
        /// cares about changed" (a commit, pull, checkout, merge, or branch move). Every
        /// one of those always touches at least one of .git/HEAD, .git/packed-refs, a
        /// file under .git/refs/heads, or .git/logs/HEAD, so the newest mtime among them
        /// is a reliable proxy without spawning `git log` just to find out. Uncommitted
        /// working-tree edits deliberately do NOT move any of these — the commit graph
        /// only ever renders committed history, so that's correct, not a gap.
        ///
        /// Git #1984 — the graph itself renders `git log --all`, which also spans
        /// `refs/remotes/**`. A `git fetch` that advances e.g. `origin/main` writes
        /// `.git/refs/remotes/origin/main` and `.git/logs/refs/remotes/origin/main`,
        /// touching neither of the local-only paths above, so the signature stayed
        /// byte-identical and the graph never re-rendered after a fetch. Now also
        /// walks `refs/remotes/**` and `logs/refs/remotes/**`, the same per-file
        /// mtime approach already used for `refs/heads`. Measured against this repo's
        /// own real `.git` (packed via periodic `git gc`, so only the recently-moved
        /// remote refs stay loose): 3 loose files under `refs/remotes`, 92 under
        /// `logs/refs` total — both negligible next to the `git log` subprocess this
        /// gate exists to avoid. `packed-refs` (already sampled above) covers whichever
        /// remote refs are packed rather than loose.
        /// </summary>
        private string ComputeGitGraphSignature()
        {
            try
            {
                string gitDir = System.IO.Path.Combine(RootWorkspacePath, ".git");
                DateTime newest = DateTime.MinValue;

                void Consider(string path)
                {
                    if (System.IO.File.Exists(path))
                    {
                        var t = System.IO.File.GetLastWriteTimeUtc(path);
                        if (t > newest) newest = t;
                    }
                }

                void ConsiderAllFilesUnder(string dir)
                {
                    if (System.IO.Directory.Exists(dir))
                    {
                        foreach (var f in System.IO.Directory.EnumerateFiles(dir, "*", System.IO.SearchOption.AllDirectories))
                            Consider(f);
                    }
                }

                Consider(System.IO.Path.Combine(gitDir, "HEAD"));
                Consider(System.IO.Path.Combine(gitDir, "packed-refs"));
                Consider(System.IO.Path.Combine(gitDir, "logs", "HEAD"));

                ConsiderAllFilesUnder(System.IO.Path.Combine(gitDir, "refs", "heads"));
                ConsiderAllFilesUnder(System.IO.Path.Combine(gitDir, "refs", "remotes"));
                ConsiderAllFilesUnder(System.IO.Path.Combine(gitDir, "logs", "refs", "remotes"));

                return newest.Ticks.ToString();
            }
            catch
            {
                // Never let a failed probe suppress a real refresh — a unique
                // signature just means "always refresh," the safe failure direction.
                return Guid.NewGuid().ToString();
            }
        }

        /// <summary>
        /// Fetches the real commit DAG and renders it into GitGraphHost. Runs
        /// the (blocking) git call on a worker thread, then builds the WPF
        /// visuals on the UI thread. Called from RefreshGitStatus so the graph
        /// and the Changes list always refresh from the same trigger (#859),
        /// and from BtnGitGraphToggle_Click on expand.
        ///
        /// Git #1968 — this used to do all of that unconditionally on every single
        /// call, including the ~40x/minute #859 FileSystemWatcher auto-refresh, even
        /// though the graph is collapsed by default and most of those calls found
        /// nothing had changed. Two gates now short-circuit the expensive part (the
        /// `git log` subprocess + full swimlane visual-tree rebuild): skip entirely
        /// while collapsed (nobody can see it), and skip if ComputeGitGraphSignature()
        /// shows nothing graph-relevant has moved since the last real render.
        /// </summary>
        public async void PopulateGitGraph()
        {
            if (GitGraphHost.Visibility != Visibility.Visible) return;

            string signature = ComputeGitGraphSignature();
            if (_lastGitGraphSignature != null && signature == _lastGitGraphSignature) return;

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

            // Git #1968 — re-sampled after the fetch (not reused from before it) so what's
            // stored reflects the git state actually captured, in case a commit landed in
            // the narrow window while `git log` was running.
            _lastGitGraphSignature = ComputeGitGraphSignature();

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

        private async void BtnGitCommit_Click(object sender, RoutedEventArgs e)
        {
            string msg = GitCommitMsgBox.Text.Trim();
            if (string.IsNullOrEmpty(msg))
            {
                GitStatusSummaryText.Text = "Please enter a commit message";
                return;
            }

            // Git #2535 — only clear the box on a genuine zero-exit commit. A failed commit
            // (nothing staged, hook rejection, ...) now shows git's real error AND keeps the
            // typed message so the user can fix the cause and retry without retyping it.
            bool ok = await RunGitCommand($"commit -m \"{msg.Replace("\"", "\\\"")}\"");
            if (ok)
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
            // Chats view is a card list now — "collapse all" folds every epic section.
            if (_currentView == "Chats")
            {
                _expandedEpicKeys.Clear();
                RenderChatsTree();
                return;
            }
            // Collapse all top-level nodes in the active tree
            var tree = _currentView == "Explorer" ? ExplorerTree : ChatsTree;
            foreach (var item in tree.Items)
            {
                if (tree.ItemContainerGenerator.ContainerFromItem(item) is TreeViewItem tvi)
                    tvi.IsExpanded = false;
            }
        }

        // ── MICROSOFT GRAPH API PANEL ───────────────────────────────────────
        private List<GraphApiTreeItemData> _allReadOnlyApis = new();
        private List<GraphApiTreeItemData> _allWriteApis = new();

        public async void PopulateGraphApiTree()
        {
            if (_api == null) return;

            try
            {
                // Fetch Read-Only monitor checks from monitor_checks
                var checksSql = "SELECT key, label, description, endpoint, method, required_variables FROM monitor_checks WHERE status = 'active' ORDER BY key;";
                var checksResults = await LocalSqlExecutor.ExecuteAsync(_api, checksSql);

                var roApis = new List<GraphApiTreeItemData>();
                if (checksResults != null && checksResults.Count > 0 && checksResults[0].Success)
                {
                    foreach (var row in checksResults[0].Rows)
                    {
                        var key = GetStr(row, "key");
                        var label = GetStr(row, "label");
                        var desc = GetStr(row, "description");
                        var endpoint = GetStr(row, "endpoint");
                        var method = GetStr(row, "method");
                        var requiredVarsJson = row.TryGetValue("required_variables", out var val) ? val : default;
                        var vars = new List<string>();
                        if (requiredVarsJson.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var item in requiredVarsJson.EnumerateArray())
                            {
                                vars.Add(item.GetString() ?? "");
                            }
                        }

                        roApis.Add(new GraphApiTreeItemData
                        {
                            Type = GraphApiEndpointType.ReadOnly,
                            Key = key,
                            Label = label,
                            Description = desc,
                            Endpoint = endpoint,
                            Method = method,
                            RequiredVariables = vars
                        });
                    }
                }

                // Fetch Write Action templates from baseline_action_templates
                var writesSql = "SELECT template_id, label, description, category, endpoint, method, required_variables, body_template FROM baseline_action_templates WHERE status = 'active' ORDER BY template_id;";
                var writesResults = await LocalSqlExecutor.ExecuteAsync(_api, writesSql);

                var wrApis = new List<GraphApiTreeItemData>();
                if (writesResults != null && writesResults.Count > 0 && writesResults[0].Success)
                {
                    foreach (var row in writesResults[0].Rows)
                    {
                        var templateId = GetStr(row, "template_id");
                        var label = GetStr(row, "label");
                        var desc = GetStr(row, "description");
                        var endpoint = GetStr(row, "endpoint");
                        var method = GetStr(row, "method");
                        var bodyTemplate = "";
                        if (row.TryGetValue("body_template", out var bodyEl) && bodyEl.ValueKind == JsonValueKind.Object)
                        {
                            bodyTemplate = JsonSerializer.Serialize(bodyEl, new JsonSerializerOptions { WriteIndented = true });
                        }

                        var requiredVarsJson = row.TryGetValue("required_variables", out var val) ? val : default;
                        var vars = new List<string>();
                        if (requiredVarsJson.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var item in requiredVarsJson.EnumerateArray())
                            {
                                vars.Add(item.GetString() ?? "");
                            }
                        }

                        wrApis.Add(new GraphApiTreeItemData
                        {
                            Type = GraphApiEndpointType.Write,
                            Key = templateId,
                            Label = label,
                            Description = desc,
                            Endpoint = endpoint,
                            Method = method,
                            RequiredVariables = vars,
                            BodyTemplate = bodyTemplate
                        });
                    }
                }

                _allReadOnlyApis = roApis;
                _allWriteApis = wrApis;

                Dispatcher.Invoke(RenderGraphApiTree);
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    GraphApiTree.Items.Clear();
                    GraphApiTree.Items.Add(new TreeViewItem { Header = $"Error loading APIs: {ex.Message}", Foreground = (Brush)FindResource("RedBrush") });
                });
            }
        }

        private void RenderGraphApiTree()
        {
            GraphApiTree.Items.Clear();

            var filter = GraphApiSearchBox.Text.Trim();
            var isFiltered = !string.IsNullOrEmpty(filter);

            // Filter lists
            var roFiltered = _allReadOnlyApis.Where(a => 
                !isFiltered || 
                a.Key.Contains(filter, StringComparison.OrdinalIgnoreCase) || 
                a.Label.Contains(filter, StringComparison.OrdinalIgnoreCase) || 
                a.Endpoint.Contains(filter, StringComparison.OrdinalIgnoreCase)
            ).ToList();

            var wrFiltered = _allWriteApis.Where(a => 
                !isFiltered || 
                a.Key.Contains(filter, StringComparison.OrdinalIgnoreCase) || 
                a.Label.Contains(filter, StringComparison.OrdinalIgnoreCase) || 
                a.Endpoint.Contains(filter, StringComparison.OrdinalIgnoreCase)
            ).ToList();

            // 1. Read-Only APIs Root
            var readOnlyRoot = new TreeViewItem
            {
                Header = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    Children = {
                        new TextBlock { Text = "📖 ", VerticalAlignment = VerticalAlignment.Center },
                        new TextBlock { Text = "Read-Only Graph APIs", FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("Subtext1Brush"), VerticalAlignment = VerticalAlignment.Center },
                        new Border {
                            Background = (Brush)FindResource("Surface0Brush"), CornerRadius = new CornerRadius(3), Padding = new Thickness(4, 1, 4, 1), Margin = new Thickness(6, 0, 0, 0),
                            Child = new TextBlock { Text = roFiltered.Count.ToString(), FontSize = 9, Foreground = (Brush)FindResource("Subtext0Brush") }
                        }
                    }
                },
                IsExpanded = isFiltered
            };

            foreach (var item in roFiltered)
            {
                var tvi = new TreeViewItem
                {
                    Header = new StackPanel
                    {
                        Orientation = Orientation.Horizontal,
                        Children = {
                            new Border {
                                Background = new SolidColorBrush(Color.FromArgb(0x33, 0x89, 0xD1, 0x17)), BorderBrush = (Brush)FindResource("SapphireBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(3), Padding = new Thickness(4, 1, 4, 1), Margin = new Thickness(0, 0, 6, 0),
                                Child = new TextBlock { Text = item.Method, FontSize = 8.5, FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("SapphireBrush") }
                            },
                            new TextBlock { Text = $"{item.Key} ({item.Label})", FontSize = 11, Foreground = (Brush)FindResource("TextBrush"), TextTrimming = TextTrimming.CharacterEllipsis }
                        }
                    },
                    Tag = item
                };
                readOnlyRoot.Items.Add(tvi);
            }

            // 2. Write APIs Root
            var writeRoot = new TreeViewItem
            {
                Header = new StackPanel
                {
                    Orientation = Orientation.Horizontal,
                    Children = {
                        new TextBlock { Text = "✍️ ", VerticalAlignment = VerticalAlignment.Center },
                        new TextBlock { Text = "Write Graph APIs", FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("Subtext1Brush"), VerticalAlignment = VerticalAlignment.Center },
                        new Border {
                            Background = (Brush)FindResource("Surface0Brush"), CornerRadius = new CornerRadius(3), Padding = new Thickness(4, 1, 4, 1), Margin = new Thickness(6, 0, 0, 0),
                            Child = new TextBlock { Text = wrFiltered.Count.ToString(), FontSize = 9, Foreground = (Brush)FindResource("Subtext0Brush") }
                        }
                    }
                },
                IsExpanded = isFiltered
            };

            foreach (var item in wrFiltered)
            {
                var tvi = new TreeViewItem
                {
                    Header = new StackPanel
                    {
                        Orientation = Orientation.Horizontal,
                        Children = {
                            new Border {
                                Background = new SolidColorBrush(Color.FromArgb(0x33, 0xE6, 0x45, 0x45)), BorderBrush = (Brush)FindResource("RedBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(3), Padding = new Thickness(4, 1, 4, 1), Margin = new Thickness(0, 0, 6, 0),
                                Child = new TextBlock { Text = item.Method, FontSize = 8.5, FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("RedBrush") }
                            },
                            new TextBlock { Text = $"{item.Key} ({item.Label})", FontSize = 11, Foreground = (Brush)FindResource("TextBrush"), TextTrimming = TextTrimming.CharacterEllipsis }
                        }
                    },
                    Tag = item
                };
                writeRoot.Items.Add(tvi);
            }

            GraphApiTree.Items.Add(readOnlyRoot);
            GraphApiTree.Items.Add(writeRoot);
        }

        private void GraphApiSearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            RenderGraphApiTree();
        }

        private void GraphApiTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is GraphApiTreeItemData item)
            {
                GraphApiSelected?.Invoke(this, new GraphApiSelectionArgs
                {
                    Type = item.Type,
                    Key = item.Key,
                    Label = item.Label,
                    Description = item.Description,
                    Endpoint = item.Endpoint,
                    Method = item.Method,
                    RequiredVariables = item.RequiredVariables,
                    BodyTemplate = item.BodyTemplate
                });
            }
        }

        private static string GetStr(Dictionary<string, JsonElement> row, string field)
        {
            return row.TryGetValue(field, out var val) && val.ValueKind == JsonValueKind.String ? val.GetString() ?? "" : "";
        }
    }
}

using System;
using System.Windows;
using System.Windows.Controls;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git Mode state management for MainWindow — rebuilt in Git #4247 to match Test Mode's real
    /// panel-reuse architecture instead of the old full-span translucent overlay.
    ///
    /// Like Test Mode, Git Mode swaps two column-scoped controls and leaves the center document
    /// area (EditorTabs) completely alone:
    ///   • Left (Grid.Column 0 / ColActivityBar): hide ActivityBar, show <see cref="GitModeRailPanel"/>
    ///     (48px rail / 300px expanded — the exact collapsed/expanded idiom TestModeDiagnosticsPanel
    ///     uses). The real epic/issue TREE is the LeftSidebar's own Git Board ("Issues") view, kept
    ///     visible in Grid.Column 1 — no from-scratch tree rebuild.
    ///   • Right (Queue column's cell, Grid.Column 5): hide BuildQueuePanel, show
    ///     <see cref="GitModeIssueDetailPanel"/>, which hosts the real <see cref="IssueDetailView"/>.
    ///   • The Dependency Graph is its own native document tab (<see cref="GitModeGraphTab"/>),
    ///     opened/focused by Tag key the same way Settings / Batter Up tabs are.
    /// </summary>
    public partial class MainWindow
    {
        private bool _isGitMode;
        public bool IsGitMode => _isGitMode;
        private bool _gitModeInitialized;

        private const string GitModeGraphTabChannel = "git-mode.graph-tab";
        private const string GitModeGraphTabKey = "git-mode-graph:main";

        // Persistent singleton — same convention as the Batter Up / What's Remaining tabs, so its
        // state (loaded graph, filters) survives a close/reopen and its GitHubIssueMirror.SyncCompleted
        // subscription operates on one live instance.
        private GitModeGraphTab? _gitModeGraphTab;

        // Saved workspace layout state — mirrors EnterTestMode's save/restore-column-width shape.
        private GridLength _savedGitColActivityBarWidth = new(48);
        private GridLength _savedGitColSidebarWidth = new(260);
        private GridLength _savedGitColQueueWidth = new(300);
        private bool _savedGitQueuePinned = true;
        private Visibility _savedGitSidebarSplitterVisibility = Visibility.Visible;
        private string _savedGitSidebarView = "Issues";

        /// <summary>Toggle Git Mode on or off.</summary>
        public void ToggleGitMode()
        {
            if (_isGitMode)
                ExitGitMode();
            else
                EnterGitMode();
        }

        private void InitializeGitModePanels()
        {
            if (_gitModeInitialized) return;
            _gitModeInitialized = true;

            // Rail (Grid.Column 0) — expand/collapse drives ColActivityBar width exactly the way
            // TestModeDiagnosticsPanel.ExpansionChanged drives it.
            GitModeRailPanel.ExpansionChanged += (expanded) =>
            {
                ColActivityBar.Width = new GridLength(expanded ? 300 : 48);
            };
            GitModeRailPanel.OpenGraphRequested += OpenGitModeGraphTab;
            GitModeRailPanel.RefreshBoardRequested += () => LeftSidebar.PopulateGitTrackerBoard(forceFresh: true);
            GitModeRailPanel.ExitGitModeRequested += ExitGitMode;

            // Right panel (Queue column) — its header Exit button leaves Git Mode.
            GitModeIssueDetailPanel.ExitGitModeRequested += ExitGitMode;
        }

        /// <summary>Activates Git Mode. Mirrors EnterTestMode's exact save/hide/show sequence, but
        /// keeps the LeftSidebar (real epic/issue tree) VISIBLE — switched to the Git Board view —
        /// rather than collapsing it, since that tree is Git Mode's left content.</summary>
        public void EnterGitMode()
        {
            if (_isGitMode)
            {
                ToastEngine.Warning("Git Mode", "Already in Git Mode. Press Ctrl+Shift+G or click Exit to return.");
                return;
            }

            // Exit Test Mode first so the two modes never fight over the same columns.
            if (_isTestMode)
            {
                ExitTestMode();
            }

            InitializeGitModePanels();
            _isGitMode = true;

            // 1. Save current workspace layout state.
            _savedGitColActivityBarWidth = ColActivityBar.Width;
            _savedGitColSidebarWidth = ColSidebar.Width;
            _savedGitColQueueWidth = ColQueue.Width;
            _savedGitQueuePinned = _queuePinned;
            _savedGitSidebarSplitterVisibility = SidebarSplitter.Visibility;
            _savedGitSidebarView = LeftSidebar.GetCurrentView();

            // 2. Left: hide the normal activity bar, show the Git Mode rail (collapsed 48px).
            ActivityBar.Visibility = Visibility.Collapsed;
            GitModeRailPanel.Visibility = Visibility.Visible;
            GitModeRailPanel.IsExpanded = false;
            ColActivityBar.Width = new GridLength(48);

            // 3. Keep LeftSidebar visible as the real epic/issue tree, switched to the Git Board view.
            if (ColSidebar.Width.Value <= 0)
            {
                ColSidebar.Width = new GridLength(DefaultSidebarWidth);
                LeftSidebar.ExpandPanel();
            }
            SidebarSplitter.Visibility = Visibility.Visible;
            LeftSidebar.SyncPinState(true);
            LeftSidebar.SwitchView("Issues");

            // 4. Right: replace the Build Queue with the Git Mode issue-detail panel.
            BuildQueuePanel.Visibility = Visibility.Collapsed;
            GitModeIssueDetailPanel.Visibility = Visibility.Visible;
            ColQueue.Width = new GridLength(420);

            // Persist mode state (best-effort).
            try
            {
                var settings = BuildConsoleSettings.Load();
                if (!settings.IsGitMode)
                {
                    settings.IsGitMode = true;
                    settings.Save();
                }
            }
            catch { /* best-effort */ }

            ToastEngine.Info("Git Mode", "Entered Git Mode (Ctrl+Shift+G to toggle)");
        }

        /// <summary>Exits Git Mode and restores the workspace layout to what it was on entry.
        /// Mirrors ExitTestMode; never touches EditorTabs / the center column.</summary>
        public void ExitGitMode()
        {
            if (!_isGitMode)
                return;

            _isGitMode = false;

            // 1. Hide Git Mode panels.
            GitModeRailPanel.Visibility = Visibility.Collapsed;
            GitModeIssueDetailPanel.Visibility = Visibility.Collapsed;

            // 2. Restore the left activity bar & its column width.
            ActivityBar.Visibility = Visibility.Visible;
            // Git #4261 — guard against a saved GridLength that isn't Absolute (Auto/Star both
            // report a nonzero .Value even though it isn't a pixel width), which would otherwise
            // assign a bogus width instead of falling back to the fixed default.
            ColActivityBar.Width = (_savedGitColActivityBarWidth.IsAbsolute && _savedGitColActivityBarWidth.Value > 0) ? _savedGitColActivityBarWidth : new GridLength(48);

            // 3. Restore the sidebar width, splitter, and previously-active view — restoring a
            //    collapsed sidebar to collapsed, the same faithful restore ExitTestMode does.
            ColSidebar.Width = (_savedGitColSidebarWidth.IsAbsolute && _savedGitColSidebarWidth.Value > 0) ? _savedGitColSidebarWidth : new GridLength(0);
            SidebarSplitter.Visibility = _savedGitSidebarSplitterVisibility;
            if (!string.IsNullOrEmpty(_savedGitSidebarView) && !string.Equals(_savedGitSidebarView, "Issues", StringComparison.Ordinal))
            {
                LeftSidebar.SwitchView(_savedGitSidebarView);
            }
            LeftSidebar.SyncPinState(ColSidebar.Width.Value > 0);

            // 4. Restore the Build Queue.
            BuildQueuePanel.Visibility = Visibility.Visible;
            _queuePinned = _savedGitQueuePinned;
            ColQueue.Width = (_savedGitColQueueWidth.IsAbsolute && _savedGitColQueueWidth.Value > 0) ? _savedGitColQueueWidth : new GridLength(DefaultQueueWidth);
            UpdateColQueueWidth();

            try
            {
                var settings = BuildConsoleSettings.Load();
                if (settings.IsGitMode)
                {
                    settings.IsGitMode = false;
                    settings.Save();
                }
            }
            catch { /* best-effort */ }

            ToastEngine.Info("Git Mode", "Exited Git Mode");
        }

        /// <summary>Open (or focus, across every pane) the single Dependency Graph document tab —
        /// same open-or-focus + header/close/drag recipe as Settings / Batter Up (Git #4247).</summary>
        public void OpenGitModeGraphTab()
        {
            if (FocusExistingDocumentTab(GitModeGraphTabKey))
            {
                ActivityLog.Log(GitModeGraphTabChannel, "focus existing tab");
                return;
            }

            if (_gitModeGraphTab == null)
            {
                _gitModeGraphTab = new GitModeGraphTab();
                // A node click loads that issue's real detail into the right-hand panel.
                _gitModeGraphTab.IssueFocusRequested += LoadGitModeIssueDetail;
            }

            AddSingletonDocumentTab(GitModeGraphTabKey, "🕸", "Dependency Graph", _gitModeGraphTab, GitModeGraphTabChannel);
        }

        /// <summary>Load an issue's real detail into the right-hand Git Mode panel. Entering Git Mode
        /// first if it isn't active (e.g. a graph-tab node click after the mode was toggled off).</summary>
        public void LoadGitModeIssueDetail(int issueNumber)
        {
            if (issueNumber <= 0) return;
            if (!_isGitMode) EnterGitMode();
            GitModeIssueDetailPanel.LoadIssue(issueNumber);
        }

        private void MenuToggleGitMode_Click(object sender, RoutedEventArgs e)
        {
            ToggleGitMode();
        }
    }
}

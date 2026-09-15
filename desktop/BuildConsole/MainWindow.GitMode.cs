using System;
using System.Windows;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git Mode state management for MainWindow (Phase 1 Shell & Phase 2 Tree).
    /// Manages top-level Git Mode toggle, navigation persistence, container visibility, and node filtering.
    /// Integrated seamlessly with full layout takeover matching Test Mode.
    /// </summary>
    public partial class MainWindow
    {
        private bool _isGitMode;
        public bool IsGitMode => _isGitMode;
        private bool _gitModeInitialized;

        private GridLength _savedGitColActivityBarWidth;
        private GridLength _savedGitColSidebarWidth;
        private GridLength _savedGitColQueueWidth;
        private Visibility _savedGitSidebarSplitterVisibility;
        private Visibility _savedGitActivityBarVisibility;
        private Visibility _savedGitBuildQueueVisibility;

        /// <summary>Toggle Git Mode on or off.</summary>
        public void ToggleGitMode()
        {
            if (_isGitMode)
                ExitGitMode();
            else
                EnterGitMode();
        }

        private void InitializeGitModeContainer()
        {
            if (_gitModeInitialized || GitModeContainer == null) return;
            _gitModeInitialized = true;

            GitModeContainer.NodeSelected += (s, node) =>
            {
                OnGitModeNodeSelected(node);
            };

            GitModeContainer.ExitGitModeRequested += (s, e) =>
            {
                ExitGitMode();
            };
        }

        private void OnGitModeNodeSelected(GitModeTreeNode node)
        {
            ActivityLog.Log("git-mode", $"Node Selected: [{node.Type}] #{node.Id} '{node.Title}' (Open: {node.OpenCount})");
            ToastEngine.Info("Git Mode Filter", $"Filtered to {node.Type}: #{node.Id} {node.Title}");
        }

        /// <summary>
        /// Activates Git Mode top-level shell.
        /// Takes over workspace view seamlessly (matching Test Mode behavior).
        /// </summary>
        public void EnterGitMode()
        {
            if (_isGitMode)
            {
                ToastEngine.Warning("Git Mode", "Already in Git Mode. Press Ctrl+Shift+G or click Exit to return.");
                return;
            }

            // Exit Test Mode if active to prevent mode overlap
            if (_isTestMode)
            {
                ExitTestMode();
            }

            InitializeGitModeContainer();
            _isGitMode = true;

            // 1. Save workspace layout state
            _savedGitColActivityBarWidth = ColActivityBar.Width;
            _savedGitColSidebarWidth = ColSidebar.Width;
            _savedGitColQueueWidth = ColQueue.Width;
            _savedGitSidebarSplitterVisibility = SidebarSplitter.Visibility;
            _savedGitActivityBarVisibility = ActivityBar.Visibility;
            _savedGitBuildQueueVisibility = BuildQueuePanel != null ? BuildQueuePanel.Visibility : Visibility.Visible;

            // 2. Hide normal workspace sidebars / queue / splitters so no ghosting occurs
            ActivityBar.Visibility = Visibility.Collapsed;
            if (LeftSidebar != null) LeftSidebar.Visibility = Visibility.Collapsed;
            if (SidebarSplitter != null) SidebarSplitter.Visibility = Visibility.Collapsed;
            if (BuildQueuePanel != null) BuildQueuePanel.Visibility = Visibility.Collapsed;

            // 3. Display Git Mode Container shell (spanning entire workspace Grid Columns 0..5)
            if (GitModeContainer != null)
            {
                GitModeContainer.Visibility = Visibility.Visible;
                _ = GitModeContainer.RefreshAllAsync();
            }

            // Update persistent settings state
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

            ToastEngine.Info("Git Mode", "Entered Git Mode (CTRL+SHIFT+G to toggle)");
        }

        /// <summary>
        /// Exits Git Mode and restores normal workspace view seamlessly.
        /// </summary>
        public void ExitGitMode()
        {
            if (!_isGitMode)
                return;

            _isGitMode = false;

            // 1. Hide Git Mode Container shell
            if (GitModeContainer != null)
            {
                GitModeContainer.Visibility = Visibility.Collapsed;
            }

            // 2. Restore normal workspace panels and column widths
            ActivityBar.Visibility = _savedGitActivityBarVisibility;
            if (LeftSidebar != null) LeftSidebar.Visibility = Visibility.Visible;
            if (SidebarSplitter != null) SidebarSplitter.Visibility = _savedGitSidebarSplitterVisibility;
            if (BuildQueuePanel != null) BuildQueuePanel.Visibility = _savedGitBuildQueueVisibility;

            ColActivityBar.Width = (_savedGitColActivityBarWidth.IsAbsolute && _savedGitColActivityBarWidth.Value > 0) ? _savedGitColActivityBarWidth : new GridLength(48);
            ColSidebar.Width = (_savedGitColSidebarWidth.IsAbsolute && _savedGitColSidebarWidth.Value > 0) ? _savedGitColSidebarWidth : new GridLength(260);
            ColQueue.Width = (_savedGitColQueueWidth.IsAbsolute && _savedGitColQueueWidth.Value > 0) ? _savedGitColQueueWidth : new GridLength(300);

            // Update persistent settings state
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

        private void MenuToggleGitMode_Click(object sender, RoutedEventArgs e)
        {
            ToggleGitMode();
        }
    }
}

using System;
using System.Windows;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git Mode state management for MainWindow (Phase 1 Shell & Phase 2 Tree).
    /// Manages top-level Git Mode toggle, navigation persistence, container visibility, and node filtering.
    /// </summary>
    public partial class MainWindow
    {
        private bool _isGitMode;
        public bool IsGitMode => _isGitMode;
        private bool _gitModeInitialized;

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
        }

        private void OnGitModeNodeSelected(GitModeTreeNode node)
        {
            ActivityLog.Log("git-mode", $"Node Selected: [{node.Type}] #{node.Id} '{node.Title}' (Open: {node.OpenCount})");
            ToastEngine.Info("Git Mode Filter", $"Filtered to {node.Type}: #{node.Id} {node.Title}");
        }

        /// <summary>
        /// Activates Git Mode top-level shell.
        /// Shows the 3-panel container and updates persistent navigation state.
        /// </summary>
        public void EnterGitMode()
        {
            if (_isGitMode)
                return;

            InitializeGitModeContainer();
            _isGitMode = true;

            // Display Git Mode Container shell
            if (GitModeContainer != null)
            {
                GitModeContainer.Visibility = Visibility.Visible;
                _ = GitModeContainer.RefreshTreeAsync();
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
        /// Exits Git Mode and restores normal workspace view.
        /// </summary>
        public void ExitGitMode()
        {
            if (!_isGitMode)
                return;

            _isGitMode = false;

            // Hide Git Mode Container shell
            if (GitModeContainer != null)
            {
                GitModeContainer.Visibility = Visibility.Collapsed;
            }

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

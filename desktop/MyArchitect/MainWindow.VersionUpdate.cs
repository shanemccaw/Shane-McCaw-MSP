using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using MyArchitect.Services;

namespace MyArchitect
{
    /// <summary>
    /// Git #3507 — version status bar + Update button, ported from
    /// <c>desktop/BuildConsole/MainWindow.VersionUpdate.cs</c> (UI_RULES.md §6).
    ///
    /// The status bar shows a live "Current: v{Major}.{Minor}.{build}" against
    /// the current local repo (git commit count for desktop/MyArchitect; see
    /// <see cref="VersionInfo"/>). When that's ahead of the build THIS instance
    /// was compiled from (<see cref="VersionInfo.RunningBuild"/>), it shows the
    /// diff and reveals the Update button. Clicking it shells out to
    /// deploy-myarchitect.cmd, which owns the pull/build/relaunch — no separate
    /// client-side deploy logic here.
    ///
    /// Unlike BuildConsole's own version-update mechanism, there is deliberately
    /// no metered-connection gate: that gate exists to stop an *agent* from
    /// triggering an uncapped rebuild unattended. Clicking Update here is Shane
    /// acting deliberately, so the button is always live when a newer build
    /// exists.
    /// </summary>
    public partial class MainWindow
    {
        private DispatcherTimer? _versionCheckTimer;

        // Last live build number computed from the local repo (null = couldn't read git).
        private int? _currentBuild;

        // Guards against launching deploy-myarchitect.cmd more than once.
        private bool _deployInvoked;

        /// <summary>Called once from the constructor. Seeds the display with the running version, then starts the live current-version poll.</summary>
        private void InitializeVersionUpdate()
        {
            StatusVersionTextBlock.Text = $"MyArchitect {VersionInfo.RunningVersion}";

            // Re-derive the current (live repo) build every 30s — cheap local git
            // call, off the UI thread. That's frequent enough to notice a fresh
            // MyArchitect commit without polling git hard.
            _versionCheckTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
            _versionCheckTimer.Tick += async (_, _) => await CheckVersionAsync();
            _versionCheckTimer.Start();
            _ = CheckVersionAsync();
        }

        /// <summary>Computes the current (live repo) build off the UI thread, then updates the status bar / Update button on it.</summary>
        private async Task CheckVersionAsync()
        {
            int? current = await Task.Run(() => VersionInfo.GetCurrentBuild());
            _currentBuild = current;
            ApplyVersionUiState();
        }

        /// <summary>Renders the current-version text + Update button visibility from the latest known state, always respecting an in-progress deploy.</summary>
        private void ApplyVersionUiState()
        {
            // A launched deploy owns the button/text until the process is replaced —
            // never re-enable it out from under an in-flight deploy.
            if (_deployInvoked)
            {
                UpdateAvailableButton.Content = "Deploying…";
                UpdateAvailableButton.IsEnabled = false;
                UpdateAvailableButton.Visibility = Visibility.Visible;
                return;
            }

            if (_currentBuild == null)
            {
                StatusVersionTextBlock.Text = $"MyArchitect {VersionInfo.RunningVersion} (repo n/a)";
                UpdateAvailableButton.Visibility = Visibility.Collapsed;
                return;
            }

            int behind = _currentBuild.Value - VersionInfo.RunningBuild;

            if (behind > 0)
            {
                StatusVersionTextBlock.Text =
                    $"Current: {VersionInfo.Format(_currentBuild.Value)} · running {VersionInfo.RunningVersion} ({behind} behind)";
                UpdateAvailableButton.Content = "Update available";
                UpdateAvailableButton.ToolTip =
                    $"A newer MyArchitect build ({behind} commit{(behind == 1 ? "" : "s")}) is committed locally — deploy it via deploy-myarchitect.cmd.";
                UpdateAvailableButton.IsEnabled = true;
                UpdateAvailableButton.Visibility = Visibility.Visible;
            }
            else if (behind == 0)
            {
                StatusVersionTextBlock.Text = $"Current: {VersionInfo.Format(_currentBuild.Value)}";
                UpdateAvailableButton.Visibility = Visibility.Collapsed;
            }
            else
            {
                StatusVersionTextBlock.Text =
                    $"Current: {VersionInfo.Format(_currentBuild.Value)} · running {VersionInfo.RunningVersion} (ahead)";
                UpdateAvailableButton.Visibility = Visibility.Collapsed;
            }
        }

        /// <summary>Update button click — shells out to deploy-myarchitect.cmd, which owns the pull/build/relaunch.</summary>
        private void UpdateAvailableButton_Click(object sender, RoutedEventArgs e)
        {
            RunDeployScript();
        }

        /// <summary>
        /// Shells out to deploy-myarchitect.cmd (Process.Start). The script pulls
        /// origin/main, rebuilds Release, stops the running MyArchitect instance
        /// and relaunches it — so its own relaunch replaces the running process;
        /// no post-script handling is needed here.
        /// </summary>
        private void RunDeployScript()
        {
            if (_deployInvoked) return;

            string? repoRoot = VersionInfo.FindRepoRoot();
            string? scriptPath = repoRoot != null
                ? Path.Combine(repoRoot, "desktop", "MyArchitect", "deploy-myarchitect.cmd")
                : null;

            if (scriptPath == null || !File.Exists(scriptPath))
            {
                System.Windows.MessageBox.Show(
                    $"Couldn't find deploy-myarchitect.cmd under desktop\\MyArchitect (repoRoot={repoRoot ?? "null"}) — deploy not started.",
                    "Update MyArchitect", MessageBoxButton.OK, MessageBoxImage.Warning);
                ApplyVersionUiState();
                return;
            }

            try
            {
                _deployInvoked = true;
                ApplyVersionUiState();

                Process.Start(new ProcessStartInfo
                {
                    FileName = scriptPath,
                    WorkingDirectory = Path.GetDirectoryName(scriptPath)!,
                    UseShellExecute = true, // run the .cmd in its own console window so Shane can watch the build
                });
            }
            catch (Exception ex)
            {
                _deployInvoked = false;
                System.Windows.MessageBox.Show(
                    $"Couldn't start the deploy: {ex.Message}",
                    "Update MyArchitect", MessageBoxButton.OK, MessageBoxImage.Error);
                ApplyVersionUiState();
            }
        }
    }
}

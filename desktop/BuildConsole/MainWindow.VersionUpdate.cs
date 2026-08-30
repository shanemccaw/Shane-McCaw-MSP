using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Version status bar + auto-Update button.
    ///
    /// The status bar shows a live "Current: v{Major}.{Minor}.{build}" against
    /// the current local repo (git commit count for desktop/BuildConsole; see
    /// <see cref="VersionInfo"/>). When that's ahead of the build THIS instance
    /// was compiled from (<see cref="VersionInfo.RunningBuild"/>), it shows the
    /// diff and reveals the Update button. Clicking it deploys the newer build
    /// to bin\ShanesBuild via deploy-shanesbuild.cmd immediately, regardless of
    /// whether the Build Queue is active (Git #1934 — reverses #1370's old
    /// block-and-wait, now that #1804's durable-file redirect + pid-adoption keep
    /// in-flight builds alive through the deploy restart).
    ///
    /// All logging goes to the "version-update" ActivityLog channel.
    /// </summary>
    public partial class MainWindow
    {
        private const string VersionChannel = "version-update";

        private DispatcherTimer? _versionCheckTimer;

        // Last live build number computed from the local repo (null = couldn't read git).
        private int? _currentBuild;

        // Guards against launching deploy-shanesbuild.cmd more than once.
        private bool _deployInvoked;

        /// <summary>Called once from the constructor (after InitializeComponent). Seeds the display with the running version, then starts the live current-version poll.</summary>
        private void InitializeVersionUpdate()
        {
            CurrentVersionText.Text = $"Current: {VersionInfo.RunningVersion}";
            ActivityLog.Log(VersionChannel,
                $"Running build embedded at compile time: {VersionInfo.RunningVersion}.");

            // Re-derive the current (live repo) build every 30s — cheap local git
            // call, off the UI thread. That's frequent enough to notice a fresh
            // BuildConsole commit without polling git hard.
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

            if (current == null)
            {
                ActivityLog.Log(VersionChannel,
                    "Version check: couldn't read the current build (git unavailable or not a repo).");
            }
            else
            {
                int behind = current.Value - VersionInfo.RunningBuild;
                string state = behind > 0 ? $"{behind} behind — update available"
                             : behind == 0 ? "up to date"
                             : "running ahead of local repo";
                ActivityLog.Log(VersionChannel,
                    $"Version check: running {VersionInfo.RunningVersion}, current {VersionInfo.Format(current.Value)} ({state}).");
            }

            ApplyVersionUiState();
        }

        /// <summary>Renders the current-version text + Update button visibility from the latest known state, always respecting an in-progress pending/deploying state.</summary>
        private void ApplyVersionUiState()
        {
            // A launched (or pending) deploy owns the button/text until the process
            // is replaced — never re-enable it out from under an in-flight deploy.
            if (_deployInvoked)
            {
                BtnUpdate.Content = "✓ Deploying…";
                BtnUpdate.IsEnabled = false;
                BtnUpdate.Visibility = Visibility.Visible;
                return;
            }

            if (_currentBuild == null)
            {
                CurrentVersionText.Text = $"Current: {VersionInfo.RunningVersion} (repo n/a)";
                CurrentVersionText.Foreground = (Brush)Application.Current.FindResource("Subtext1Brush");
                BtnUpdate.Visibility = Visibility.Collapsed;
                return;
            }

            int behind = _currentBuild.Value - VersionInfo.RunningBuild;

            if (behind > 0)
            {
                CurrentVersionText.Text =
                    $"Current: {VersionInfo.Format(_currentBuild.Value)} · running {VersionInfo.RunningVersion} ({behind} behind)";
                CurrentVersionText.Foreground = (Brush)Application.Current.FindResource("PeachBrush");
            }
            else if (behind == 0)
            {
                CurrentVersionText.Text = $"Current: {VersionInfo.Format(_currentBuild.Value)}";
                CurrentVersionText.Foreground = (Brush)Application.Current.FindResource("Subtext1Brush");
            }
            else
            {
                CurrentVersionText.Text =
                    $"Current: {VersionInfo.Format(_currentBuild.Value)} · running {VersionInfo.RunningVersion} (ahead)";
                CurrentVersionText.Foreground = (Brush)Application.Current.FindResource("Subtext1Brush");
            }

            if (behind > 0)
            {
                BtnUpdate.Content = "⬆ Update";
                BtnUpdate.IsEnabled = true;
                BtnUpdate.Visibility = Visibility.Visible;
            }
            else
            {
                BtnUpdate.Visibility = Visibility.Collapsed;
            }
        }

        /// <summary>Clicking the Deploy/Current version status bar item triggers immediate rebuild and deploy to bin\ShanesBuild.</summary>
        private async void DeployStatus_Click(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            await CheckVersionAsync();
            await TriggerUpdateAsync(forceDeploy: true);
        }

        /// <summary>Update button click — decides immediately-deploy vs defer based on the real Build Queue's active state.</summary>
        private async void BtnUpdate_Click(object sender, RoutedEventArgs e)
        {
            await TriggerUpdateAsync(forceDeploy: false);
        }

        private async Task TriggerUpdateAsync(bool forceDeploy = false)
        {
            if (_deployInvoked) return;

            BtnUpdate.IsEnabled = false; // no double-trigger while the deploy spins up
            ActivityLog.Log(VersionChannel,
                $"Rebuild & Deploy requested (force={forceDeploy}): {VersionInfo.RunningVersion} → {(_currentBuild.HasValue ? VersionInfo.Format(_currentBuild.Value) : "latest local code")}.");

            // Git #1934 — deploy immediately, regardless of whether the Build Queue is
            // active. This deliberately reverses #1370's block-and-wait: at that time a
            // deploy restart killed in-flight builds, so waiting for the queue to drain
            // was a real safeguard. #1804 (durable-file stdout/stderr redirect) plus the
            // pid-adoption-on-restart path mean launched builds now survive the deploy
            // restart and are re-adopted into Build Watch on relaunch, so the wait no
            // longer buys anything — it only delayed Shane's update behind long-running
            // builds. Just deploy.
            ActivityLog.Log(VersionChannel, "Rebuilding & deploying now (in-flight builds survive the restart via #1804).");
            RunDeployScript();
            await Task.CompletedTask;
        }

        /// <summary>
        /// Shells out to deploy-shanesbuild.cmd (Process.Start). The script
        /// rebuilds Release, stops the running bin\ShanesBuild instance and
        /// relaunches it — so its own relaunch replaces the running process; no
        /// post-script handling is needed here.
        /// </summary>
        private void RunDeployScript()
        {
            if (_deployInvoked) return;

            string? repoRoot = VersionInfo.FindRepoRoot();
            string? scriptPath = repoRoot != null
                ? Path.Combine(repoRoot, "desktop", "BuildConsole", "deploy-shanesbuild.cmd")
                : null;

            if (scriptPath == null || !File.Exists(scriptPath))
            {
                ActivityLog.Log(VersionChannel,
                    $"FAILED: deploy-shanesbuild.cmd not found (repoRoot={repoRoot ?? "null"}).");
                ToastEngine.Warning("Update BuildConsole",
                    "Couldn't find deploy-shanesbuild.cmd under desktop\\BuildConsole — deploy not started.");
                // Re-offer the button so Shane can retry once the path is sorted.
                ApplyVersionUiState();
                return;
            }

            try
            {
                ActivityLog.Log(VersionChannel,
                    $"Invoking deploy-shanesbuild.cmd (target {(_currentBuild.HasValue ? VersionInfo.Format(_currentBuild.Value) : "current")}) — {scriptPath}");
                _deployInvoked = true;
                DeployDot.Fill = DotLoading;
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
                ActivityLog.Log(VersionChannel, $"FAILED to launch deploy-shanesbuild.cmd: {ex.Message}");
                ToastEngine.Error("Update BuildConsole",
                    $"Couldn't start the deploy: {ex.Message}");
                ApplyVersionUiState();
            }
        }
    }
}

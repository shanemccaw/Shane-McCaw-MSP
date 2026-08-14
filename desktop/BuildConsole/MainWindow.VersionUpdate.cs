using System;
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
    /// to bin\ShanesBuild via deploy-shanesbuild.cmd — immediately if the Build
    /// Queue is clear, otherwise deferred behind a loud persistent banner that
    /// auto-fires the moment the queue drains.
    ///
    /// All logging goes to the "version-update" ActivityLog channel.
    /// </summary>
    public partial class MainWindow
    {
        private const string VersionChannel = "version-update";

        private DispatcherTimer? _versionCheckTimer;
        private DispatcherTimer? _pendingDeployPollTimer;

        // Last live build number computed from the local repo (null = couldn't read git).
        private int? _currentBuild;

        // An Update was requested but the Build Queue was active, so the deploy is
        // deferred until the queue drains (then it auto-fires — no second click).
        private bool _updatePending;

        // Guards against launching deploy-shanesbuild.cmd more than once.
        private bool _deployInvoked;

        // Guards the async pending poll against overlapping ticks.
        private bool _pendingPollInFlight;

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
                if (!_updatePending) BtnUpdate.Visibility = Visibility.Collapsed;
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

            if (_updatePending)
            {
                // Deploy already queued behind the Build Queue — keep the button as a
                // disabled pending indicator; the banner carries the real reminder.
                BtnUpdate.Content = "⏳ Update pending…";
                BtnUpdate.IsEnabled = false;
                BtnUpdate.Visibility = Visibility.Visible;
            }
            else if (behind > 0)
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

        /// <summary>Update button click — decides immediately-deploy vs defer based on the real Build Queue's active state.</summary>
        private async void BtnUpdate_Click(object sender, RoutedEventArgs e)
        {
            if (_deployInvoked || _updatePending) return;

            BtnUpdate.IsEnabled = false; // no double-trigger while we check the queue
            ActivityLog.Log(VersionChannel,
                $"Update requested: {VersionInfo.RunningVersion} → {(_currentBuild.HasValue ? VersionInfo.Format(_currentBuild.Value) : "current")}.");

            // Freshen the queue snapshot so the clear/active decision is real, not
            // up-to-15s stale (RefreshAsync swallows its own errors).
            try { await BuildQueuePanel.RefreshAsync(); } catch { /* best-effort */ }

            if (!BuildQueuePanel.HasActiveQueueItems)
            {
                ActivityLog.Log(VersionChannel, "Build Queue clear — deploying now.");
                RunDeployScript();
                return;
            }

            // Queue active — defer. Show the loud banner and poll until it drains.
            _updatePending = true;
            ActivityLog.Log(VersionChannel,
                "Build Queue active — deferring deploy until it clears (queue-block engaged).");
            UpdatePendingBannerText.Text = _currentBuild.HasValue
                ? $"Update to {VersionInfo.Format(_currentBuild.Value)} pending — waiting for the Build Queue to clear before deploying…"
                : "Update pending — waiting for the Build Queue to clear before deploying…";
            UpdatePendingBanner.Visibility = Visibility.Visible;
            ApplyVersionUiState();

            _pendingDeployPollTimer ??= CreatePendingDeployPollTimer();
            _pendingDeployPollTimer.Start();
        }

        private DispatcherTimer CreatePendingDeployPollTimer()
        {
            var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(5) };
            t.Tick += async (_, _) => await PendingDeployPollAsync();
            return t;
        }

        /// <summary>While a deploy is deferred, re-checks the real Build Queue every 5s and auto-fires the script the instant it's empty.</summary>
        private async Task PendingDeployPollAsync()
        {
            if (!_updatePending || _deployInvoked) return;
            if (_pendingPollInFlight) return; // RefreshAsync can outlast the 5s interval
            _pendingPollInFlight = true;
            try
            {
                try { await BuildQueuePanel.RefreshAsync(); } catch { /* best-effort */ }

                // Keep the live version fresh too, so the banner/label reflect reality
                // if more commits land while we wait.
                _currentBuild = await Task.Run(() => VersionInfo.GetCurrentBuild());
                ApplyVersionUiState();

                if (!BuildQueuePanel.HasActiveQueueItems)
                {
                    ActivityLog.Log(VersionChannel,
                        "Build Queue cleared — auto-starting the deferred deploy (queue-block cleared).");
                    _pendingDeployPollTimer?.Stop();
                    _updatePending = false;
                    UpdatePendingBanner.Visibility = Visibility.Collapsed;
                    RunDeployScript();
                }
            }
            finally
            {
                _pendingPollInFlight = false;
            }
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
                _updatePending = false;
                _pendingDeployPollTimer?.Stop();
                UpdatePendingBanner.Visibility = Visibility.Collapsed;
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

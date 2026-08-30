using System;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #1779 — "Dispatch #___": a third door into the exact same
    /// <see cref="Services.BuildQueuePostgresClient.QueueBuildAsync"/> pipeline #1709's Batter
    /// Up panel and #1710's AI Batter Up panel already feed. Fetches one issue directly via
    /// <see cref="Services.GitHubApiClient.GetIssueAsync"/> — deliberately NOT filtered by
    /// board status, since typing a number and hitting Dispatch is itself the explicit
    /// approval — parses its `BUILD:` comment with #1709's existing
    /// <see cref="Services.BatterUpQueueService.FindBuildCommentAsync"/>, and queues it through
    /// the same client BatterUpPanel and BuildQueuePanel already use. Owns no launch logic of
    /// its own and never touches BatterUpPanel, AiBatterUpPanel, or BuildQueuePanel's own
    /// Queue/Send to Builder/Cancel actions.
    /// </summary>
    public partial class DispatchPanel : UserControl
    {
        private Services.BuildQueuePostgresClient? _db;
        private Services.SessionLimitAutoRestartService? _autoRestart;
        private System.Windows.Threading.DispatcherTimer? _countdownTimer;
        private bool _dispatching;

        /// <summary>Fired after a successful direct dispatch so MainWindow can tell the
        /// sibling BuildQueuePanel to repaint — same "best-effort visual refresh" pattern
        /// BatterUpPanel.RowsAutoQueued already follows.</summary>
        public event EventHandler? Dispatched;

        public DispatchPanel()
        {
            InitializeComponent();
            this.Unloaded += DispatchPanel_Unloaded;
        }

        /// <summary>Mirrors BatterUpPanel.Initialize's shape — called once from MainWindow.</summary>
        public void Initialize(Services.BuildQueuePostgresClient? db, Services.SessionLimitAutoRestartService? autoRestart)
        {
            _db = db;
            _autoRestart = autoRestart;

            if (_autoRestart != null)
            {
                _countdownTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
                _countdownTimer.Tick += CountdownTimer_Tick;
                _countdownTimer.Start();
                CountdownTimer_Tick(null, EventArgs.Empty); // Force immediate refresh
            }
        }

        private void DispatchPanel_Unloaded(object sender, RoutedEventArgs e)
        {
            if (_countdownTimer != null)
            {
                _countdownTimer.Stop();
                _countdownTimer.Tick -= CountdownTimer_Tick;
                _countdownTimer = null;
            }
        }

        private void CountdownTimer_Tick(object? sender, EventArgs e)
        {
            if (_autoRestart == null)
            {
                TxtCountdown.Visibility = Visibility.Collapsed;
                return;
            }

            var restartAt = _autoRestart.RestartAtLocal;
            var resetAt = _autoRestart.ResetAtLocal;

            if (!restartAt.HasValue)
            {
                TxtCountdown.Visibility = Visibility.Collapsed;
                return;
            }

            var now = DateTime.Now;
            if (now >= restartAt.Value)
            {
                TxtCountdown.Visibility = Visibility.Collapsed;
                return;
            }

            TxtCountdown.Visibility = Visibility.Visible;

            // Determine if we are before or after the reset time
            var actualResetAt = resetAt ?? restartAt.Value.AddMinutes(-1); // Fallback to 1 min before restart

            if (now < actualResetAt)
            {
                var timeToReset = actualResetAt - now;
                string countdownStr;
                if (timeToReset.TotalHours >= 1)
                {
                    countdownStr = $"{(int)timeToReset.TotalHours}h {timeToReset.Minutes}m";
                }
                else
                {
                    countdownStr = $"{timeToReset.Minutes}m {timeToReset.Seconds}s";
                }
                TxtCountdown.Text = $"{actualResetAt:h:mm tt} ({countdownStr})";
                TxtCountdown.Foreground = (Brush)Application.Current.FindResource("Subtext0Brush");
            }
            else
            {
                // We are between the reset time and the restart time.
                // Flip to a T-1 min timer counting down to when the queue is going to reset (restart paused builds)
                var timeToRestart = restartAt.Value - now;
                if (timeToRestart < TimeSpan.Zero) timeToRestart = TimeSpan.Zero;
                
                string countdownStr = $"{(int)timeToRestart.TotalMinutes}:{timeToRestart.Seconds:D2}";
                TxtCountdown.Text = $"T-{countdownStr}";
                TxtCountdown.Foreground = (Brush)Application.Current.FindResource("RedBrush");
            }
        }

        private void TxtIssueNumber_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter) _ = DispatchAsync();
        }

        private async void BtnDispatch_Click(object sender, RoutedEventArgs e) => await DispatchAsync();

        private void ShowStatus(string text, Brush brush)
        {
            TxtStatus.Text = text;
            TxtStatus.Foreground = brush;
            TxtStatus.Visibility = Visibility.Visible;
        }

        public async System.Threading.Tasks.Task DispatchAsync()
        {
            if (_dispatching) return;

            var raw = TxtIssueNumber.Text?.Trim().TrimStart('#') ?? "";
            if (!int.TryParse(raw, out var issueNumber) || issueNumber <= 0)
            {
                ShowStatus("Enter a valid issue number.", (Brush)Application.Current.FindResource("RedBrush"));
                return;
            }

            var settings = Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ShowStatus("No GitHub PAT configured — set one in Settings.", (Brush)Application.Current.FindResource("RedBrush"));
                return;
            }

            _dispatching = true;
            BtnDispatch.IsEnabled = false;
            ShowStatus($"Fetching #{issueNumber}…", (Brush)Application.Current.FindResource("Subtext0Brush"));
            try
            {
                var gh = new Services.GitHubApiClient(settings.GitHubPat);

                // Fetched directly by number, deliberately bypassing GetBatterUpIssuesAsync's
                // board-status filter — this entry point exists precisely to skip that gate.
                Services.GitHubIssueDetail? issue;
                try
                {
                    issue = await gh.GetIssueAsync(issueNumber);
                }
                catch (Exception ex)
                {
                    ShowStatus($"Couldn't reach GitHub: {ex.Message}", (Brush)Application.Current.FindResource("RedBrush"));
                    return;
                }

                if (issue == null)
                {
                    ShowStatus($"#{issueNumber} not found.", (Brush)Application.Current.FindResource("RedBrush"));
                    return;
                }

                // Reuse #1709's own parser — not a second one.
                var (rawComment, parsed) = await Services.BatterUpQueueService.FindBuildCommentAsync(gh, issueNumber);
                if (rawComment == null || parsed == null)
                {
                    ShowStatus($"No build prompt found on #{issueNumber} yet.", (Brush)Application.Current.FindResource("RedBrush"));
                    Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} \"{issue.Title}\" — no BUILD: comment found, nothing queued.");
                    return;
                }

                var (model, effort, buildSet, prompt) = parsed.Value;

                var blockers = await gh.GetBlockedByAsync(issueNumber);
                var blockedByNumbers = blockers.Select(b => b.Number).ToList();
                var openBlockedByNumbers = blockers.Where(b => !b.IsClosed).Select(b => b.Number).ToList();

                if (_db == null)
                {
                    ShowStatus("Not connected to the build queue database.", (Brush)Application.Current.FindResource("RedBrush"));
                    return;
                }

                // Same dedup convention BatterUpQueueService follows — an already-tracked row
                // for this issue is reported rather than silently duplicated.
                var existing = await _db.FindDedupCandidateAsync(issueNumber, prompt);
                if (existing != null)
                {
                    ShowStatus($"#{issueNumber} is already tracked (status: {existing.Status}).", (Brush)Application.Current.FindResource("BlueBrush"));
                    return;
                }

                await _db.QueueBuildAsync(
                    title: issue.Title,
                    prompt: prompt,
                    model: model,
                    effort: effort,
                    cwd: null,
                    githubNumber: issueNumber,
                    blockedByNumbers: blockedByNumbers,
                    buildSet: buildSet);

                Services.ActivityLog.Log("dispatch",
                    $"Dispatch #{issueNumber} \"{issue.Title}\" — queued (model={model ?? "default"}, effort={effort ?? "default"}, buildSet={buildSet ?? "none"}" +
                    (blockedByNumbers.Count > 0 ? $", blocked-by={string.Join(",", blockedByNumbers)}" : "") + ").");

                // Fail-closed (#1600) governs launch, same as every other path — an open real
                // blocker holds it after queueing rather than refusing to queue it at all.
                if (openBlockedByNumbers.Count > 0)
                {
                    ShowStatus($"#{issueNumber} queued, but held — blocked by #{string.Join(", #", openBlockedByNumbers)}.",
                        (Brush)Application.Current.FindResource("RedBrush"));
                }
                else
                {
                    ShowStatus($"#{issueNumber} \"{issue.Title}\" queued.", (Brush)Application.Current.FindResource("GreenBrush"));
                }

                TxtIssueNumber.Text = "";
                try { Dispatched?.Invoke(this, EventArgs.Empty); }
                catch { /* best-effort visual refresh of the sibling queue panel */ }
            }
            catch (Exception ex)
            {
                ShowStatus($"Dispatch failed: {ex.Message}", (Brush)Application.Current.FindResource("RedBrush"));
                Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — FAILED: {ex.Message}");
            }
            finally
            {
                _dispatching = false;
                BtnDispatch.IsEnabled = true;
            }
        }
    }
}

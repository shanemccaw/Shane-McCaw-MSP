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
        private Services.QueueWatcherService? _watcher;
        private System.Windows.Threading.DispatcherTimer? _countdownTimer;
        private bool _dispatching;

        /// <summary>Git #1966 — the issue number a "Dispatch anyway" click applies to, set only
        /// while the dedup-guard status + button are showing. Cleared at the top of every fresh
        /// DispatchAsync/ForceDispatchAsync attempt so a stale click can never fire against the
        /// wrong issue.</summary>
        private int? _pendingForceIssueNumber;

        /// <summary>Fired after a successful direct dispatch so MainWindow can tell the
        /// sibling BuildQueuePanel to repaint — same "best-effort visual refresh" pattern
        /// BatterUpPanel.RowsAutoQueued already follows.</summary>
        public event EventHandler? Dispatched;

        public DispatchPanel()
        {
            InitializeComponent();
            this.Unloaded += DispatchPanel_Unloaded;
        }

        /// <summary>Mirrors BatterUpPanel.Initialize's shape — called once from MainWindow.
        /// Git #1966 — <paramref name="watcher"/> lets a force re-dispatch tell a genuinely-live
        /// local build from a stuck/claimed DB row before deciding whether the "kill this" second
        /// confirmation is warranted; optional so a caller with no watcher (agent mode) still
        /// gets the rest of this panel.</summary>
        public void Initialize(Services.BuildQueuePostgresClient? db, Services.SessionLimitAutoRestartService? autoRestart, Services.QueueWatcherService? watcher = null)
        {
            _db = db;
            _autoRestart = autoRestart;
            _watcher = watcher;

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

        private async void BtnForceDispatch_Click(object sender, RoutedEventArgs e) => await ForceDispatchAsync();

        private void ShowStatus(string text, Brush brush)
        {
            TxtStatus.Text = text;
            TxtStatus.Foreground = brush;
            TxtStatus.Visibility = Visibility.Visible;
        }

        public async System.Threading.Tasks.Task DispatchAsync()
        {
            if (_dispatching) return;

            // Git #1966 — a fresh attempt always starts clean; a stale "Dispatch anyway" from a
            // previous dedup hit must never linger against a different issue number.
            _pendingForceIssueNumber = null;
            BtnForceDispatch.Visibility = Visibility.Collapsed;

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
                    // Git #2063 — rather than dead-ending here, ask whatever chat is CURRENTLY
                    // ACTIVE (not necessarily the epic-linked chat — Shane just decided "this is
                    // ready" in some active chat right before hitting Dispatch) to write and post
                    // the BUILD: comment itself, via the same #2059 send+submit bridge.
                    ShowStatus($"No build prompt found on #{issueNumber} yet — asking the active chat…",
                        (Brush)Application.Current.FindResource("Subtext0Brush"));
                    Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} \"{issue.Title}\" — no BUILD: comment found, asking active chat.");

                    var mainWindow = Application.Current.MainWindow as MainWindow;
                    string askStatus = mainWindow != null
                        ? await mainWindow.SendToActiveChatAsync(Services.ActiveChatBuildRequestHelper.BuildAskMessage(issueNumber, issue.Title))
                        : "no-active-chat";

                    var (message, isError) = Services.ActiveChatBuildRequestHelper.DescribeStatus(askStatus, issueNumber);
                    ShowStatus(message, (Brush)Application.Current.FindResource(isError ? "RedBrush" : "BlueBrush"));
                    Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — ask-active-chat status: {askStatus}");
                    return;
                }

                var (model, effort, buildSet, _, prompt) = parsed.Value;

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
                    // Git #1966 — no longer a dead end: the existing message stays verbatim, and
                    // an inline "Dispatch anyway" affordance appears alongside it. The dedup guard
                    // assumes an existing row means an active, healthy build; it does not — this
                    // is the operator override for when it's stuck instead.
                    ShowStatus($"#{issueNumber} is already tracked (status: {existing.Status}).", (Brush)Application.Current.FindResource("BlueBrush"));
                    _pendingForceIssueNumber = issueNumber;
                    BtnForceDispatch.Visibility = Visibility.Visible;
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

        /// <summary>
        /// Git #1966 — the operator override for the dead end above: "#N is already tracked" is
        /// no longer the end of the road. Re-fetches the issue and its BUILD: comment LIVE (never
        /// reuses anything cached from the blocked attempt — the prompt may have been edited
        /// since), re-checks the dedup candidate LIVE too, then supersedes that row before
        /// queueing fresh so there is never more than one live bt_build_queue row for this issue.
        ///
        /// Finalizing the existing row reuses the exact per-status paths BuildQueuePanel's own
        /// QuickCancelOrStopAsync already uses — no second finalize mechanism: CancelAsync for a
        /// still-queued/parked/limit-paused/capped row, the watcher Stop + MarkCompleteAsync(-1)
        /// pair for a running one, and MarkCompleteAsync(-1) alone for anything else (verifying /
        /// external / already-terminal) that neither of those paths reaches.
        ///
        /// A second confirmation — naming what will be killed — fires ONLY when the row is
        /// GENUINELY running: DB status "running" *and* this app's own QueueWatcherService is
        /// actually tracking a live process for it. A row merely claimed (status flipped to
        /// "running" the instant the watcher grabbed it) with no real process behind it — the
        /// #1954 case this issue exists to fix — needs no such ceremony; it is the ordinary,
        /// ceremony-free case here, exactly as the issue body specifies.
        /// </summary>
        public async System.Threading.Tasks.Task ForceDispatchAsync()
        {
            if (_dispatching) return;
            if (_pendingForceIssueNumber == null || _db == null) return;
            var issueNumber = _pendingForceIssueNumber.Value;

            var settings = Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                ShowStatus("No GitHub PAT configured — set one in Settings.", (Brush)Application.Current.FindResource("RedBrush"));
                return;
            }

            _dispatching = true;
            BtnDispatch.IsEnabled = false;
            BtnForceDispatch.IsEnabled = false;
            ShowStatus($"Re-checking #{issueNumber}…", (Brush)Application.Current.FindResource("Subtext0Brush"));
            try
            {
                var gh = new Services.GitHubApiClient(settings.GitHubPat);

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

                var (rawComment, parsed) = await Services.BatterUpQueueService.FindBuildCommentAsync(gh, issueNumber);
                if (rawComment == null || parsed == null)
                {
                    ShowStatus($"No build prompt found on #{issueNumber} anymore.", (Brush)Application.Current.FindResource("RedBrush"));
                    return;
                }

                var (model, effort, buildSet, _, prompt) = parsed.Value;

                var blockers = await gh.GetBlockedByAsync(issueNumber);
                var blockedByNumbers = blockers.Select(b => b.Number).ToList();
                var openBlockedByNumbers = blockers.Where(b => !b.IsClosed).Select(b => b.Number).ToList();

                // Live re-fetch of the dedup candidate at force time — not the row that triggered
                // the guard a moment ago; something else may have already moved it on.
                var existing = await _db.FindDedupCandidateAsync(issueNumber, prompt);

                bool genuinelyRunning = existing != null && existing.Status == "running"
                    && _watcher != null
                    && _watcher.IsInteractiveRenderable(existing.Id)
                    && !_watcher.HasExited(existing.Id, out _);

                if (genuinelyRunning)
                {
                    var confirm = MessageBox.Show(
                        $"#{issueNumber} \"{existing!.Title}\" (queue #{existing.Id}) is genuinely running right now.\n\n" +
                        "Forcing a re-dispatch will stop that build and start a fresh one. Continue?",
                        "Force Re-Dispatch — Build Is Running",
                        MessageBoxButton.YesNo, MessageBoxImage.Warning);
                    if (confirm != MessageBoxResult.Yes)
                    {
                        ShowStatus($"Force re-dispatch of #{issueNumber} canceled — build left running.", (Brush)Application.Current.FindResource("Subtext0Brush"));
                        return;
                    }
                }

                string? supersededDescr = null;
                if (existing != null)
                {
                    supersededDescr = $"#{existing.Id} (was {existing.Status})";
                    if (existing.Status == "running")
                    {
                        // Same body as BuildQueuePanel's QuickCancelOrStopAsync "running" branch —
                        // a safe no-op locally if this app instance isn't the one tracking it.
                        _watcher?.TryStop(existing.Id);
                        _watcher?.ReleaseInteractive(existing.Id);
                        await _db.MarkCompleteAsync(existing.Id, -1);
                    }
                    else if (existing.Status is "queued" or "parked"
                             or Services.SessionLimitAutoRestartService.LimitPausedStatus
                             or Services.AccountCapPolicy.CappedStatus)
                    {
                        // Same CancelAsync the Build Queue panel's own Cancel action uses.
                        await _db.CancelAsync(existing.Id);
                    }
                    else if (!Services.BuildQueuePostgresClient.IsTerminalStatus(existing.Status))
                    {
                        // Verifying / external — no cancel path reaches these and there's no live
                        // process to stop; MarkCompleteAsync closes the row out the same way Stop
                        // does for "running", without pretending a stop occurred.
                        await _db.MarkCompleteAsync(existing.Id, -1);
                    }
                    // Already terminal (done/failed/canceled) — nothing to supersede.
                }

                var queued = await _db.QueueBuildAsync(
                    title: issue.Title,
                    prompt: prompt,
                    model: model,
                    effort: effort,
                    cwd: null,
                    githubNumber: issueNumber,
                    blockedByNumbers: blockedByNumbers,
                    buildSet: buildSet);

                Services.ActivityLog.Log("dispatch",
                    $"Force re-dispatch #{issueNumber} \"{issue.Title}\" — superseded {(supersededDescr ?? "(no existing row)")}" +
                    $" → queue #{queued.Id} (status={queued.Status}, model={model ?? "default"}, effort={effort ?? "default"}, buildSet={buildSet ?? "none"}" +
                    (blockedByNumbers.Count > 0 ? $", blocked-by={string.Join(",", blockedByNumbers)}" : "") + ").");

                _pendingForceIssueNumber = null;
                BtnForceDispatch.Visibility = Visibility.Collapsed;

                // Fail-closed (#1600) governs launch, same as every other path.
                if (openBlockedByNumbers.Count > 0)
                {
                    ShowStatus($"#{issueNumber} force re-dispatched, but held — blocked by #{string.Join(", #", openBlockedByNumbers)}.",
                        (Brush)Application.Current.FindResource("RedBrush"));
                }
                else
                {
                    ShowStatus($"#{issueNumber} \"{issue.Title}\" force re-dispatched.", (Brush)Application.Current.FindResource("GreenBrush"));
                }

                TxtIssueNumber.Text = "";
                try { Dispatched?.Invoke(this, EventArgs.Empty); }
                catch { /* best-effort visual refresh of the sibling queue panel */ }
            }
            catch (Exception ex)
            {
                ShowStatus($"Force re-dispatch failed: {ex.Message}", (Brush)Application.Current.FindResource("RedBrush"));
                Services.ActivityLog.Log("dispatch", $"Force re-dispatch #{issueNumber} — FAILED: {ex.Message}");
            }
            finally
            {
                _dispatching = false;
                BtnDispatch.IsEnabled = true;
                BtnForceDispatch.IsEnabled = true;
            }
        }
    }
}

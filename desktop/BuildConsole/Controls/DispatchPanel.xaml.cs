using System;
using System.Collections.Generic;
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

        /// <summary>Git #2716 — one entry per issue currently waiting on its own BUILD: comment.
        /// Added when DispatchAsync hits NoBuildComment and asks the active chat to write one;
        /// removed once <see cref="RecheckPendingBuildCommentsAsync"/> either dispatches it for
        /// real or gives up. Session-scoped, in-memory — doesn't need cross-restart persistence.</summary>
        private sealed class PendingBuildCommentRetry
        {
            public string IssueTitle = "";
            public DateTime FirstAskedUtc;
            public int RecheckAttempts;
        }

        private readonly Dictionary<int, PendingBuildCommentRetry> _pendingBuildCommentRetries = new();

        /// <summary>Give-up point (Git #2716) — a real, stated bound so a comment that never
        /// actually shows up doesn't retry forever silently: whichever of "too many board
        /// refreshes" or "too much wall-clock time" comes first.</summary>
        private const int MaxBuildCommentRecheckAttempts = 30;
        private static readonly TimeSpan MaxBuildCommentPendingAge = TimeSpan.FromHours(12);

        /// <summary>Fired after a successful direct dispatch so MainWindow can tell the
        /// sibling BuildQueuePanel to repaint — same "best-effort visual refresh" pattern
        /// BatterUpPanel.RowsAutoQueued already follows. Git #2680 — carries the dispatched
        /// issue number (captured before TxtIssueNumber.Text is cleared) so MainWindow can
        /// also auto-search the Queue panel down to that same row. Audited before this change:
        /// MainWindow.xaml.cs ~line 636 is the only subscriber in the codebase.</summary>
        public event Action<int>? Dispatched;

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

            // Git #2716 — a manual click supersedes any auto-retry already pending for this
            // issue; NoBuildComment below re-adds it if it's still missing.
            _pendingBuildCommentRetries.Remove(issueNumber);

            _dispatching = true;
            BtnDispatch.IsEnabled = false;
            ShowStatus($"Fetching #{issueNumber}…", (Brush)Application.Current.FindResource("Subtext0Brush"));
            try
            {
                // Git #2682 — the real fetch/build-comment/dedup/queue mechanics now live in
                // IssueDispatchService, shared with the Detected panel's per-item Dispatch button.
                var result = await Services.IssueDispatchService.DispatchAsync(_db, issueNumber);

                switch (result.Outcome)
                {
                    case Services.DispatchOutcome.NoBuildComment:
                        // Git #2063 — rather than dead-ending here, ask whatever chat is CURRENTLY
                        // ACTIVE (not necessarily the epic-linked chat — Shane just decided "this is
                        // ready" in some active chat right before hitting Dispatch) to write and post
                        // the BUILD: comment itself, via the same #2059 send+submit bridge.
                        ShowStatus($"No build prompt found on #{issueNumber} yet — asking the active chat…",
                            (Brush)Application.Current.FindResource("Subtext0Brush"));
                        Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} \"{result.IssueTitle}\" — no BUILD: comment found, asking active chat.");

                        var mainWindow = Application.Current.MainWindow as MainWindow;
                        string askStatus = mainWindow != null
                            ? await mainWindow.SendToActiveChatAsync(Services.ActiveChatBuildRequestHelper.BuildAskMessage(issueNumber, result.IssueTitle ?? $"#{issueNumber}"))
                            : "no-active-chat";

                        var (message, isError) = Services.ActiveChatBuildRequestHelper.DescribeStatus(askStatus, issueNumber);
                        ShowStatus(message, (Brush)Application.Current.FindResource(isError ? "RedBrush" : "BlueBrush"));
                        Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — ask-active-chat status: {askStatus}");

                        // Git #2716 — don't just dead-end here: remember this issue so the next
                        // board refresh (LeftSidebar.BoardRefreshCompleted, wired in MainWindow)
                        // rechecks for the comment automatically instead of Shane having to
                        // remember to hit Dispatch again once the chat actually posts it.
                        if (!_pendingBuildCommentRetries.ContainsKey(issueNumber))
                        {
                            _pendingBuildCommentRetries[issueNumber] = new PendingBuildCommentRetry
                            {
                                IssueTitle = result.IssueTitle ?? $"#{issueNumber}",
                                FirstAskedUtc = DateTime.UtcNow,
                            };
                            Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — queued for auto-retry on the next board refresh once a BUILD: comment appears.");
                        }
                        return;

                    case Services.DispatchOutcome.AlreadyTracked:
                        // Git #1966 — no longer a dead end: the existing message stays verbatim, and
                        // an inline "Dispatch anyway" affordance appears alongside it. The dedup guard
                        // assumes an existing row means an active, healthy build; it does not — this
                        // is the operator override for when it's stuck instead.
                        ShowStatus(result.Message, (Brush)Application.Current.FindResource("BlueBrush"));
                        _pendingForceIssueNumber = issueNumber;
                        BtnForceDispatch.Visibility = Visibility.Visible;
                        return;

                    case Services.DispatchOutcome.Queued:
                        ShowStatus(result.Message, (Brush)Application.Current.FindResource("GreenBrush"));
                        break;

                    default:
                        // NoPat / GitHubUnreachable / IssueNotFound / NoDb / QueuedButBlocked / Failed
                        ShowStatus(result.Message, (Brush)Application.Current.FindResource("RedBrush"));
                        if (result.Outcome != Services.DispatchOutcome.QueuedButBlocked) return;
                        break;
                }

                TxtIssueNumber.Text = "";
                try { Dispatched?.Invoke(issueNumber); }
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
        /// Git #2716 — rides the same manual board-refresh cascade #1813/#2557/#2688/#2711 already
        /// use (<see cref="Controls.LeftSidebar.BoardRefreshCompleted"/>, wired in MainWindow):
        /// for every issue DispatchAsync asked the active chat about but couldn't find a BUILD:
        /// comment for yet, re-run the SAME real dispatch path (<see cref="Services.IssueDispatchService.DispatchAsync"/>,
        /// which itself re-calls <see cref="Services.BatterUpQueueService.FindBuildCommentAsync"/>)
        /// so a comment that landed since the last check auto-dispatches with no second manual
        /// click. Fail-soft per entry — one issue's recheck failing never blocks the others, and
        /// never breaks the cascade for the sibling hooks on the same event.
        /// </summary>
        public async System.Threading.Tasks.Task RecheckPendingBuildCommentsAsync()
        {
            if (_pendingBuildCommentRetries.Count == 0) return;

            // Snapshot the keys — the loop body mutates the dictionary.
            foreach (var issueNumber in _pendingBuildCommentRetries.Keys.ToList())
            {
                if (!_pendingBuildCommentRetries.TryGetValue(issueNumber, out var entry)) continue;
                entry.RecheckAttempts++;

                try
                {
                    var result = await Services.IssueDispatchService.DispatchAsync(_db, issueNumber);

                    switch (result.Outcome)
                    {
                        case Services.DispatchOutcome.NoBuildComment:
                            // Still not there. Give up only past the real, stated bound — don't
                            // retry forever silently.
                            bool timedOut = DateTime.UtcNow - entry.FirstAskedUtc > MaxBuildCommentPendingAge;
                            bool tooManyAttempts = entry.RecheckAttempts >= MaxBuildCommentRecheckAttempts;
                            if (timedOut || tooManyAttempts)
                            {
                                _pendingBuildCommentRetries.Remove(issueNumber);
                                var why = timedOut ? $"no comment after {MaxBuildCommentPendingAge.TotalHours:0}h" : $"no comment after {entry.RecheckAttempts} board refreshes";
                                Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — gave up auto-retrying ({why}); dispatch manually once the BUILD: comment is posted.");
                                ToastEngine.Warning("Auto-Dispatch Gave Up", $"#{issueNumber} \"{entry.IssueTitle}\" — still no BUILD: comment ({why}). Dispatch manually when it's ready.");
                            }
                            break;

                        case Services.DispatchOutcome.Queued:
                        case Services.DispatchOutcome.QueuedButBlocked:
                            // The comment showed up — the rest of the real dispatch flow (dedup +
                            // QueueBuildAsync) already ran inside IssueDispatchService.DispatchAsync.
                            _pendingBuildCommentRetries.Remove(issueNumber);
                            Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — auto-dispatched on board refresh after its BUILD: comment appeared ({result.Outcome}).");
                            ToastEngine.Success("Auto-Dispatched", result.Message);
                            try { Dispatched?.Invoke(issueNumber); }
                            catch { /* best-effort visual refresh of the sibling queue panel */ }
                            break;

                        default:
                            // AlreadyTracked / NoPat / GitHubUnreachable / IssueNotFound / NoDb / Failed —
                            // none of these resolve themselves by the comment appearing later, so stop
                            // retrying and say plainly why rather than looping on something that can
                            // never succeed.
                            _pendingBuildCommentRetries.Remove(issueNumber);
                            Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — auto-retry stopped ({result.Outcome}): {result.Message}");
                            ToastEngine.Warning("Auto-Dispatch Stopped", $"#{issueNumber} \"{entry.IssueTitle}\" — {result.Message}");
                            break;
                    }
                }
                catch (Exception ex)
                {
                    // Leave the entry pending — a transient failure (network blip, etc.) shouldn't
                    // drop it; it'll try again on the next board refresh.
                    Services.ActivityLog.Log("dispatch", $"Dispatch #{issueNumber} — auto-retry recheck FAILED (will retry next board refresh): {ex.Message}");
                }
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
                try { Dispatched?.Invoke(issueNumber); }
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

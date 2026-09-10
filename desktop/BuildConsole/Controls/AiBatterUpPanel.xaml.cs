using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #1710 — additive "AI Batter Up" review panel, polled independently from
    /// #1709's Batter Up panel. Shows every open issue currently sitting in the real
    /// "AI Batter Up" project-board status (agent-filed findings awaiting Shane's
    /// Yes/No — CLAUDE.md's "Board status" routing rule). Yes promotes the item's
    /// Status to real "Batter Up" and leaves it there — it does NOT queue or launch
    /// anything; #1709's BatterUpPanel picks the promoted item up on its own next
    /// refresh. No demotes to "Backlog". Never touches BuildQueuePanel, BatterUpPanel,
    /// or BuildQueuePostgresClient.
    ///
    /// Git #1803 — rows render via <see cref="BuildAiBatterUpCard"/>, the same card
    /// shell/critter-mascot/status-pill pattern BuildQueuePanel's BuildQueueCard uses,
    /// with Yes/No as real footer actions inside the card instead of a plain-text
    /// ItemsControl row with bare buttons.
    /// </summary>
    public partial class AiBatterUpPanel : UserControl
    {
        // Git #2976 — the single in-flight refresh, if one is running. Overlapping callers are
        // handed this SAME task rather than the old `if (_refreshing) return;` completed no-op,
        // so a caller that awaits RefreshAsync (the manual Git Sync cascade) genuinely waits for
        // the real fetch+render to finish instead of toasting "Refreshed!" while it's still going.
        private System.Threading.Tasks.Task? _inFlightRefresh;

        // Git #1863 — the real fetched/sorted rows from the last RefreshAsync. TxtFilter
        // narrows what's rendered from this list; it never touches what's fetched or the
        // Yes/No board mutations, which always operate on the row object already in hand.
        private List<Services.AiBatterUpRow> _allRows = new();

        // Shane, 2026-08-30 — the right-column IssueDetailView tracks whichever row was
        // last clicked (SelectCard). _selectedNumber survives a RenderFilteredRows rebuild
        // (cards are rebuilt fresh every call) so the same issue re-highlights instead of
        // silently reverting to "no selection"; _selectedCard/_selectedCardOriginalBrush
        // let a plain click swap the highlight without a full rebuild.
        private int? _selectedNumber;
        private Border? _selectedCard;
        private Brush? _selectedCardOriginalBrush;

        /// <summary>Git #3448 — the real closed-sweep result from the most recent RefreshAsync,
        /// consumed by MainWindow's FullGitRefreshRequested handler to build the honest "Git Sync"
        /// toast (AI Batter Up out of sync vs. no issues) instead of a generic success message.
        /// Stays at its last real value on a refresh that errors before reaching the sweep read.</summary>
        public Services.ClosedSweepResult LastSweepResult { get; private set; }
            = Services.ClosedSweepResult.Clean;

        /// <summary>Git #1872 — fired every time RefreshAsync lands (success, no-PAT, or error),
        /// carrying the same row count TxtCount renders. MainWindow's title-bar button badge
        /// subscribes to this instead of re-fetching or polling on its own.</summary>
        public event EventHandler<int>? CountChanged;

        /// <summary>Current row count, kept in sync with TxtCount. 0 in the no-PAT/error states.</summary>
        public int Count { get; private set; }

        private void SetCount(int count)
        {
            Count = count;
            CountChanged?.Invoke(this, count);
        }

        public AiBatterUpPanel()
        {
            InitializeComponent();
            // Shane, 2026-08-30 — replace DetailPane's default SQL/test-manifest actions
            // sidebar with the linked-chat column (see IssueDetailView.RenderChatColumnAsync).
            DetailPane.ShowChatInsteadOfActions = true;

            // Git #3253 — Shane's own architectural redirect: react to the mirror's own
            // SyncCompleted event instead of a second polling timer.
            //
            // Git #3335 — subscribe HERE, in the constructor, and never unsubscribe — NOT in
            // Loaded/Unloaded (same fix as BatterUpPanel's sibling wiring). This instance is an
            // app-lifetime singleton (MainWindow builds it once as a field per
            // MainWindow.BatterUpTabs.cs and never destroys it), whose whole job is to keep the
            // always-visible top-bar count badge (TopAiBatterUpCount) fresh via CountChanged.
            // The old Loaded/Unloaded wiring only ever fired when the document tab was attached
            // to the visual tree — but Shane never opens the tab, he only watches the badge, so
            // Loaded never fired, the SyncCompleted subscription was never established, and the
            // 5-min auto-update never reached the badge at all (the exact bug #3335 traces).
            // #3253's original concerns ("a closed tab keeps repainting off-screen" / "a static
            // event outlives the view") don't apply to an app-lifetime singleton: the view IS
            // the singleton, so the event can't outlive it, and the cheap off-screen RowsList
            // render is precisely what keeps the visible badge current.
            //
            // Git #3469 — that "cheap" framing was wrong: RefreshAsync's board LIST is mirror-only,
            // but the pass around it still fires live GitHub work every time (batched BUILD-comment
            // resolution, the closed-sweep, and the auto-select detail load), regardless of whether
            // this panel's document tab is actually open. OnMirrorSyncCompleted now checks IsVisible
            // and takes the zero-live-call mirror-count-only path when the tab is closed; IsVisible
            // becomes true again fires a real RefreshAsync so the tab never opens onto stale rows.
            Services.GitHubIssueMirror.SyncCompleted += OnMirrorSyncCompleted;
            IsVisibleChanged += OnIsVisibleChanged;
        }

        /// <summary>Git #3253 — fired from whatever background context the mirror sync runs on
        /// (the watcher tick), never the UI thread. Marshal to the Dispatcher before touching
        /// anything. Git #3469 — a closed tab (IsVisible false) takes the mirror-count-only path
        /// (zero live GitHub calls) instead of the full RefreshAsync, which still does real live
        /// enrichment work (batched BUILD-comment resolution, closed-sweep, auto-select detail
        /// load) even though its board LIST is mirror-first.</summary>
        private void OnMirrorSyncCompleted()
        {
            Dispatcher.InvokeAsync(async () =>
            {
                if (IsVisible) await RefreshAsync();
                else await RefreshCountOnlyAsync();
            });
        }

        /// <summary>Git #3469 — the tab going from closed to open needs a real RefreshAsync so it
        /// never opens onto rows that are stale by up to a full mirror-sync cycle (the
        /// mirror-count-only path this panel took while closed only ever touched the badge, never
        /// RowsList/DetailPane).</summary>
        private async void OnIsVisibleChanged(object sender, System.Windows.DependencyPropertyChangedEventArgs e)
        {
            if (IsVisible) await RefreshAsync();
        }

        /// <summary>Git #3469 — the badge-only refresh for a mirror sync landing while this panel's
        /// document tab isn't open: a plain local-mirror count read, no live GitHub calls at all
        /// (no closed-sweep, no BUILD-comment resolution, no detail auto-select). Leaves the badge
        /// at its last value if the mirror isn't usable yet — never falls back to a live call just
        /// to keep an off-screen badge current.</summary>
        private async System.Threading.Tasks.Task RefreshCountOnlyAsync()
        {
            try
            {
                int? count = await Services.AiBatterUpQueueService.GetMirrorOnlyOpenCountAsync();
                if (count.HasValue) SetCount(count.Value);
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("ai-batter-up", $"Badge-only mirror count read failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Called once from MainWindow right after BatterUpPanel.Initialize.
        /// Git #1890 — no automatic timer and no auto-refresh here anymore, for consistency
        /// with #1709's BatterUpPanel (Shane named that one explicitly, but items awaiting his
        /// Yes/No review benefit from the same "only when I ask" philosophy). The panel shows
        /// whatever it last had until Shane's own manual refresh click, or Git Board's #1813
        /// manual-refresh cross-trigger, populates it.
        /// </summary>
        public void Initialize()
        {
        }

        // Git #1863 — the filter box shows only when there's something to filter: rows
        // fetched (not the "none open" / no-PAT / error states). Shane, 2026-08-30 — no
        // longer gated on a "panel expanded" check; the old BtnCollapse toggle (and the
        // collapsed-by-default state it left this document tab opening into) is gone.
        private void UpdateFilterBoxVisibility()
        {
            FilterBoxHost.Visibility = _allRows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        // Git #2737 — build a fresh client on every call, matching BatterUpPanel's convention.
        // Caching this in a field (the old `_gh ??=` pattern) meant a GitHub PAT rotated in
        // Settings after the first build never took effect until BuildConsole was restarted.
        private Services.GitHubApiClient? GetClient()
        {
            var settings = Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return null;
            return new Services.GitHubApiClient(settings.GitHubPat);
        }

        // Git #2976 — coalescing wrapper. Return the in-flight refresh (if any) so overlapping
        // callers await the SAME real fetch instead of an early-return no-op that let the manual
        // "Git Sync" toast fire before AI Batter Up actually repainted.
        public System.Threading.Tasks.Task RefreshAsync()
        {
            if (_inFlightRefresh is { IsCompleted: false }) return _inFlightRefresh;
            return _inFlightRefresh = RefreshCoreAsync();
        }

        /// <summary>Git #2926 — the honest, self-recovering counterpart to the generic "Couldn't
        /// read" failure text, for when the failure is the #2815 circuit breaker's own short-circuit
        /// rather than a real standing error.</summary>
        private static string BuildCircuitOpenMessage()
        {
            int remaining = Services.GitHubRateLimitCircuit.RemainingOpenSeconds();
            return remaining > 0
                ? $"GitHub is rate-limiting BuildConsole right now — this will recover automatically in ~{remaining}s (Git #2815), no action needed."
                : "GitHub is rate-limiting BuildConsole right now — this will recover automatically shortly (Git #2815), no action needed.";
        }

        private async System.Threading.Tasks.Task RefreshCoreAsync()
        {
            try
            {
                var gh = GetClient();
                if (gh == null)
                {
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    _allRows = new List<Services.AiBatterUpRow>();
                    UpdateFilterBoxVisibility();
                    TxtEmpty.Text = "No GitHub PAT configured — set one in Settings.";
                    TxtEmpty.Visibility = Visibility.Visible;
                    SetCount(0);
                    return;
                }

                List<Services.AiBatterUpRow> rows;
                try
                {
                    Services.ClosedSweepResult sweepResult;
                    (rows, sweepResult) = await Services.AiBatterUpQueueService.RefreshAsync(gh);
                    LastSweepResult = sweepResult;
                }
                catch (Exception ex)
                {
                    // Git #2926 — a suppressed call under the #2815 breaker is transient and
                    // self-recovering within its backoff window; show that distinctly from a real,
                    // standing failure so it doesn't read as an urgent bug (see #2916).
                    bool circuitOpen = Services.GitHubRateLimitCircuit.IsCircuitOpenMessage(ex.Message);

                    // Git #3494 / #3512 — NEVER blank the lane when we still hold real rows. #3494
                    // preserved last-known rows only on a recognized circuit-open throw; #3512 broadens
                    // that to ANY transient failure (same reasoning, and same change, as the Batter Up
                    // lane). Only a genuine first load (nothing to preserve) or a real standing failure
                    // with no prior rows falls through to the empty/error state below.
                    if (_allRows.Count > 0)
                    {
                        string why = circuitOpen ? "rate-limit circuit open" : ex.Message;
                        Services.ActivityLog.Log("ai-batter-up",
                            $"Refresh deferred ({why}) — keeping last-known {_allRows.Count} row(s); recovers automatically (Git #3494/#3512/#2815).");
                        TxtCount.Text = circuitOpen
                            ? $"({_allRows.Count}) · GitHub cooling down (#2815)"
                            : $"({_allRows.Count}) · couldn't refresh, showing last-known";
                        TxtEmpty.Visibility = Visibility.Collapsed;
                        return;
                    }

                    Services.ActivityLog.Log("ai-batter-up", $"Refresh failed: {ex.Message}");
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    _allRows = new List<Services.AiBatterUpRow>();
                    UpdateFilterBoxVisibility();
                    TxtEmpty.Text = circuitOpen
                        ? BuildCircuitOpenMessage()
                        : $"Couldn't read AI Batter Up: {ex.Message}";
                    TxtEmpty.Visibility = Visibility.Visible;
                    SetCount(0);
                    return;
                }

                // Git #1863 — highest issue number first, always. Sorted here in the panel,
                // not in AiBatterUpQueueService: the service has no other caller today, but
                // its fetch/board-mutation order isn't this panel's display order to redefine.
                _allRows = rows.OrderByDescending(r => r.Number).ToList();

                // Git #1816 — the "zero rows" empty state reads inline in the header's
                // TxtCount instead of the separate TxtEmpty block, so an empty panel's
                // footprint never grows past this one header line.
                TxtCount.Text = _allRows.Count == 0 ? "— none open" : $"({_allRows.Count})";
                TxtEmpty.Visibility = Visibility.Collapsed;
                UpdateFilterBoxVisibility();
                RenderFilteredRows();
                SetCount(_allRows.Count);
            }
            finally
            {
                // Git #2976 — release the in-flight marker so the next RefreshAsync starts a fresh
                // run. Runs on the UI thread at task completion, so it can't interleave with a
                // concurrent RefreshAsync call (also UI-thread) mid-clear.
                _inFlightRefresh = null;
            }
        }

        // Git #1863 — Shane: "AI Batter Up needs a small search by number filter." Display-only:
        // narrows what RenderFilteredRows draws from the already-fetched _allRows. Never
        // refetches, never touches PromoteToBatterUpAsync/DemoteToBacklogAsync.
        private void TxtFilter_TextChanged(object sender, TextChangedEventArgs e) => RenderFilteredRows();

        /// <summary>
        /// Renders <see cref="_allRows"/> (already sorted number-descending) filtered by
        /// TxtFilter's current text. A numeric-looking term substring-matches the issue
        /// number (typing "18" surfaces #1837, #1862, #1838 — no leading '#', no exact-match
        /// requirement); anything else falls back to matching the title too, so a
        /// non-numeric search doesn't just read as a broken, emptied panel.
        /// </summary>
        private void RenderFilteredRows()
        {
            RowsList.Children.Clear();
            // Cards are rebuilt fresh below — the old Border instance _selectedCard points
            // at is gone, so drop the reference (its highlight goes with it); _selectedNumber
            // is what actually survives the rebuild, re-applied to whichever new card matches.
            _selectedCard = null;
            _selectedCardOriginalBrush = null;

            string term = TxtFilter.Text?.Trim() ?? "";
            IEnumerable<Services.AiBatterUpRow> visible = _allRows;
            if (term.Length > 0)
            {
                visible = _allRows.Where(r =>
                    r.Number.ToString().Contains(term, StringComparison.OrdinalIgnoreCase) ||
                    (r.Title?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false));
            }

            var visibleList = visible.ToList();
            if (visibleList.Count == 0 && _allRows.Count > 0)
            {
                // Git #1863 — a filter that hides everything must say so, not just present
                // an empty panel that reads as though the queue itself drained.
                RowsList.Children.Add(new TextBlock
                {
                    Text = $"no match for \"{term}\"",
                    FontSize = 11,
                    FontStyle = FontStyles.Italic,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                    Margin = new Thickness(6, 4, 6, 4)
                });
                return;
            }

            // Shane, 2026-08-30 — re-select the same issue if it's still in view, otherwise
            // default to the top row, so the right-hand detail pane is never left blank.
            Border? toSelect = null;
            int toSelectNumber = 0;
            foreach (var row in visibleList)
            {
                var card = BuildAiBatterUpCard(row);
                RowsList.Children.Add(card);
                if (row.Number == _selectedNumber || (toSelect == null && _selectedNumber == null))
                {
                    toSelect = card;
                    toSelectNumber = row.Number;
                }
            }
            if (toSelect != null) SelectCard(toSelect, toSelectNumber);
        }

        /// <summary>
        /// Highlights <paramref name="card"/> (restoring whatever card was previously
        /// selected to its normal border) and loads its issue into the right-hand
        /// <see cref="DetailPane"/>. Shared by a plain row click and the auto-select
        /// RenderFilteredRows does on every refresh.
        /// </summary>
        private void SelectCard(Border card, int number)
        {
            if (_selectedCard != null && _selectedCard != card)
                _selectedCard.BorderBrush = _selectedCardOriginalBrush ?? _selectedCard.BorderBrush;

            if (_selectedCard != card) _selectedCardOriginalBrush = card.BorderBrush;
            card.BorderBrush = (Brush)Application.Current.FindResource("BlueBrush");
            _selectedCard = card;
            _selectedNumber = number;
            DetailPane.LoadIssue(number);
        }

        /// <summary>
        /// Applies Shane's real decision: Yes flips Status → "Batter Up" (never launches
        /// anything itself — see class docs), No flips it → "Backlog". Either way this
        /// item leaves the AI Batter Up queue, so a refresh removes its row.
        /// </summary>
        private async System.Threading.Tasks.Task ApplyDecisionAsync(StackPanel footer, Services.AiBatterUpRow r, bool promote)
        {
            var gh = GetClient();
            if (gh == null) return;

            foreach (var child in footer.Children) if (child is Button b) b.IsEnabled = false;

            try
            {
                // Git #3134 — by issue number, not the ProjectV2Item node id: the row can now be
                // sourced from the local mirror (which doesn't store the node id), and
                // SetIssueStatusByNumberAsync resolves it at click-time.
                if (promote)
                    await Services.AiBatterUpQueueService.PromoteToBatterUpAsync(gh, r.Number);
                else
                    await Services.AiBatterUpQueueService.DemoteToBacklogAsync(gh, r.Number);

                Services.ActivityLog.Log("ai-batter-up",
                    $"#{r.Number} — {(promote ? "YES: promoted to Batter Up" : "NO: demoted to Backlog")}.");
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("ai-batter-up", $"#{r.Number} — decision FAILED: {ex.Message}");
                MessageBox.Show($"Couldn't update #{r.Number} on GitHub: {ex.Message}", "AI Batter Up",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                foreach (var child in footer.Children) if (child is Button b) b.IsEnabled = true;
                return;
            }

            await RefreshAsync();
        }

        /// <summary>
        /// Git #1803 — one AI Batter Up row, built in the same card shape as
        /// BuildQueuePanel.BuildQueueCard: status pill + issue-number badge on top, title,
        /// model/effort/buildSet detail line, the same critter mascot on the right (mood
        /// WaitingForInput — this is the one human-gate review queue in the app), and a
        /// real footer action row (Yes/No) styled as card-level buttons instead of bare
        /// buttons floating next to text.
        /// </summary>
        private Border BuildAiBatterUpCard(Services.AiBatterUpRow r)
        {
            var card = BuildQueuePanel.BuildGenericCardShell(isBlocked: false);

            var mainStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };
            topRow.Children.Add(BuildQueuePanel.BuildStatusPill("❓ AWAITING REVIEW",
                Color.FromRgb(0x3E, 0x2C, 0x1A), Color.FromRgb(0xF9, 0xE2, 0xAF), Color.FromRgb(0xF9, 0xE2, 0xAF)));

            var numBadge = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x28, 0x29, 0x3D)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(5, 1.5, 5, 1.5),
                Margin = new Thickness(6, 0, 0, 0)
            };
            numBadge.Child = new TextBlock
            {
                Text = Services.LocalBuildId.FormatRef(r.Number),
                FontSize = 9.5,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)Application.Current.FindResource("PeachBrush")
            };
            topRow.Children.Add(numBadge);
            mainStack.Children.Add(topRow);

            mainStack.Children.Add(new TextBlock
            {
                Text = r.Title,
                FontSize = 11.5,
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 1, 0)
            });

            var detailParts = new List<string>();
            if (r.HasBuildComment)
            {
                detailParts.Add($"{r.Model ?? "default model"} / {r.Effort ?? "default effort"}");
                if (!string.IsNullOrWhiteSpace(r.BuildSet)) detailParts.Add($"buildSet={r.BuildSet}");
            }
            else
            {
                detailParts.Add("no BUILD: comment yet");
            }
            mainStack.Children.Add(new TextBlock
            {
                Text = string.Join("  ·  ", detailParts),
                FontSize = 10,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 0, 4)
            });

            // ── Footer action row: Yes/No as real in-card actions ──
            var footer = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(1, 0, 0, 0) };
            // Git #1810 — de-brightened to match "No"'s calm dark visual weight (same
            // dark-base-with-accent philosophy as #1705): dark Surface0Brush fill instead of a
            // solid bright GreenBrush, with green kept only as the border/text accent so "Yes"
            // still reads as green without being a jarring solid fill.
            var btnYes = new Button
            {
                Content = "Yes",
                Padding = new Thickness(10, 2, 10, 2),
                Margin = new Thickness(0, 0, 6, 0),
                Background = (Brush)Application.Current.FindResource("Surface0Brush"),
                Foreground = (Brush)Application.Current.FindResource("GreenBrush"),
                BorderBrush = (Brush)Application.Current.FindResource("GreenBrush"),
                BorderThickness = new Thickness(1),
                Cursor = System.Windows.Input.Cursors.Hand,
                ToolTip = "Promote to Batter Up"
            };
            btnYes.Click += async (_, _) => await ApplyDecisionAsync(footer, r, promote: true);
            footer.Children.Add(btnYes);

            var btnNo = new Button
            {
                Content = "No",
                Padding = new Thickness(10, 2, 10, 2),
                Background = (Brush)Application.Current.FindResource("Surface0Brush"),
                Foreground = (Brush)Application.Current.FindResource("TextBrush"),
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand,
                ToolTip = "Decline to Backlog"
            };
            btnNo.Click += async (_, _) => await ApplyDecisionAsync(footer, r, promote: false);
            footer.Children.Add(btnNo);

            // Git #1838 — Yes writes a real board Status change (Yes → "Batter Up"). This panel
            // owns no queue/launch logic, but a UI-automation agent clicks things, so in agent
            // mode the decision controls are disabled: the review board stays fully visible and
            // read-only. Only Shane's real instance can promote/demote.
            if (Services.AppMode.IsAgent)
            {
                btnYes.IsEnabled = false;
                btnNo.IsEnabled = false;
                btnYes.ToolTip = "Agent mode — board decisions are disabled";
                btnNo.ToolTip = "Agent mode — board decisions are disabled";
            }

            mainStack.Children.Add(footer);

            var cardGrid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            Grid.SetColumn(mainStack, 0);
            cardGrid.Children.Add(mainStack);

            var mascot = BuildQueuePanel.CreateGenericCardMascot(r.Number, BuildQueuePanel.CritterMood.WaitingForInput);
            Grid.SetColumn(mascot, 1);
            cardGrid.Children.Add(mascot);

            card.Child = cardGrid;

            // Shane, 2026-08-30 — click anywhere on the card (that isn't the Yes/No
            // buttons — ButtonBase already marks its own MouseLeftButtonUp Handled, so
            // this bubbling handler never fires for those) to load it into DetailPane.
            card.Cursor = System.Windows.Input.Cursors.Hand;
            card.MouseLeftButtonUp += (_, _) => SelectCard(card, r.Number);

            return card;
        }
    }
}

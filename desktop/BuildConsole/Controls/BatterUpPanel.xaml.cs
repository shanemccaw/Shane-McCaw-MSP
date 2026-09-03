using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #1709 — additive Batter Up panel. Polls the real project-board "Batter Up"
    /// status on a timer and parses each item's BUILD: comment. Git #1870 — a persisted
    /// "Free flow" gate (read LIVE each tick) decides the path: ON auto-queues eligible
    /// rows via <see cref="BatterUpQueueService.RefreshAndAutoQueueAsync"/> (the pre-#1870
    /// behaviour); OFF (the default) only LISTS the board via
    /// <see cref="BatterUpQueueService.RefreshAsync"/> and Shane queues rows one at a time
    /// with each card's Queue button (<see cref="BatterUpQueueService.QueueRowAsync"/>).
    /// Either way queuing flows through the existing BuildQueuePostgresClient.QueueBuildAsync
    /// — the same pipeline Queue / Send to Builder use. Never touches BuildQueuePanel or its
    /// launch paths; this control only reads GitHub + writes new rows via the same queue
    /// client. This gate is separate from the global Build Queue pause (QueueWatcherService):
    /// it stops rows ENTERING the queue, not launching out of it.
    ///
    /// Git #1803 — rows render via <see cref="BuildBatterUpCard"/>, the same card shell/
    /// critter-mascot/status-pill pattern BuildQueuePanel's BuildQueueCard uses, instead of
    /// a plain-text ItemsControl row.
    /// </summary>
    public partial class BatterUpPanel : UserControl
    {
        private Services.BuildQueuePostgresClient? _db;
        private bool _refreshing;

        // Git #2555 — the real fetched rows from the last RefreshAsync, in the order the board
        // refresh returned them. TxtFilter/BtnSortByState only narrow/reorder what's RENDERED
        // from this list (RenderFilteredRows); they never touch what's fetched or the queue
        // mutations, which always operate on the row object already in hand.
        private List<Services.BatterUpRow> _allRows = new();
        private bool _sortByState;

        // Shane, 2026-08-30 — the right-column IssueDetailView tracks whichever row was
        // last clicked (SelectCard). _selectedNumber survives a RefreshAsync rebuild (cards
        // are rebuilt fresh every call) so the same issue re-highlights instead of silently
        // reverting to "no selection"; _selectedCard/_selectedCardOriginalBrush let a plain
        // click swap the highlight without a full rebuild.
        private int? _selectedNumber;
        private Border? _selectedCard;
        private Brush? _selectedCardOriginalBrush;

        /// <summary>Fired after a refresh pass auto-queued one or more rows, so MainWindow can
        /// tell the sibling BuildQueuePanel to repaint — same "best-effort visual refresh"
        /// pattern every other queue-mutating action in this app already follows.</summary>
        public event EventHandler? RowsAutoQueued;

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

        public BatterUpPanel()
        {
            InitializeComponent();
            // Git #2555 — replace DetailPane's default SQL/test-manifest actions sidebar
            // with the linked-chat column (see IssueDetailView.RenderChatColumnAsync), same
            // as AiBatterUpPanel's sibling document tab already does. This panel's own
            // DetailPane never had this set, so it was showing the near-always-empty SQL
            // Migrations/test-manifest panel instead of chat.
            DetailPane.ShowChatInsteadOfActions = true;
        }

        /// <summary>
        /// Mirrors BuildQueuePanel.Initialize's shape — called once from MainWindow right after BuildQueuePanel.Initialize.
        /// Git #1890 — no automatic timer and no auto-refresh here anymore; the panel shows
        /// whatever it last had (or empty, on first-ever launch) until Shane's own manual
        /// refresh click, or Git Board's #1813 manual-refresh cross-trigger, populates it.
        /// </summary>
        public void Initialize(Services.BuildQueuePostgresClient? db)
        {
            _db = db;
        }

        /// <summary>
        /// Git #1870 — flips the persisted Free flow gate and refreshes immediately so the change
        /// is visible without waiting for the next 90s tick. This is a DIFFERENT gate from the
        /// global Build Queue pause (QueueWatcherService.SetPaused): it governs whether board rows
        /// ENTER bt_build_queue, not whether queued rows launch — the two stay independent.
        /// </summary>
        private async void BtnFreeFlow_Click(object sender, RoutedEventArgs e)
        {
            var settings = Services.BuildConsoleSettings.Load();
            settings.BatterUpFreeFlow = BtnFreeFlow.IsChecked == true;
            settings.Save();
            UpdateFreeFlowVisual(settings.BatterUpFreeFlow);
            Services.ActivityLog.Log("batter-up",
                settings.BatterUpFreeFlow
                    ? "Free flow toggled ON — approved board items will auto-queue on each refresh."
                    : "Free flow toggled OFF — gated; board items are listed only and queued by hand.");
            await RefreshAsync();
        }

        // Git #2555 — same "only show the filter box when there's something to filter" rule
        // AiBatterUpPanel's #1863 filter box uses: hidden on the no-PAT/error/zero-rows states.
        private void UpdateFilterBoxVisibility()
        {
            FilterBoxHost.Visibility = _allRows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        }

        // Git #2555 — display-only: narrows/reorders what RenderFilteredRows draws from the
        // already-fetched _allRows. Never refetches, never touches BatterUpQueueService.
        private void TxtFilter_TextChanged(object sender, TextChangedEventArgs e) => RenderFilteredRows();

        /// <summary>
        /// Git #2555 — groups rows into the real, meaningful order the issue calls for: Ready to
        /// launch (has a BUILD: comment, not blocked, no dead tracked row) → Blocked → Failed/
        /// Canceled (a dead tracked row) → No BUILD: comment yet. Reuses the exact signals already
        /// on <see cref="Services.BatterUpRow"/> — no new backend query.
        /// </summary>
        private static int StatePriority(Services.BatterUpRow r)
        {
            if (r.HasBuildComment && !r.IsBlocked && r.TrackedTerminalStatus == null) return 0; // ready to launch
            if (r.IsBlocked) return 1; // blocked
            if (r.TrackedTerminalStatus != null) return 2; // failed/canceled
            return 3; // no build comment yet
        }

        private void BtnSortByState_Click(object sender, RoutedEventArgs e)
        {
            _sortByState = BtnSortByState.IsChecked == true;
            RenderFilteredRows();
        }

        /// <summary>
        /// Renders <see cref="_allRows"/> filtered by TxtFilter's current text (issue number or
        /// title substring, case-insensitive) and, when <see cref="_sortByState"/> is on, grouped
        /// by <see cref="StatePriority"/> — otherwise left in the board's own fetch order. Shared
        /// by RefreshAsync (first render), TxtFilter_TextChanged, and BtnSortByState_Click.
        /// </summary>
        private void RenderFilteredRows()
        {
            RowsList.Children.Clear();
            // Cards are rebuilt fresh below — the old Border instance _selectedCard points at is
            // gone, so drop the reference (its highlight goes with it); _selectedNumber is what
            // actually survives the rebuild, re-applied to whichever new card matches.
            _selectedCard = null;
            _selectedCardOriginalBrush = null;

            string term = TxtFilter.Text?.Trim() ?? "";
            IEnumerable<Services.BatterUpRow> visible = _allRows;
            if (term.Length > 0)
            {
                visible = _allRows.Where(r =>
                    r.Number.ToString().Contains(term, StringComparison.OrdinalIgnoreCase) ||
                    (r.Title?.Contains(term, StringComparison.OrdinalIgnoreCase) ?? false));
            }
            if (_sortByState)
                visible = visible.OrderBy(StatePriority); // stable sort — keeps board order within each group

            var visibleList = visible.ToList();
            if (visibleList.Count == 0 && _allRows.Count > 0)
            {
                // Git #2555 — a filter that hides everything must say so, not just present an
                // empty panel that reads as though the board itself drained.
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

            Border? toSelect = null;
            int toSelectNumber = 0;
            foreach (var row in visibleList)
            {
                var card = BuildBatterUpCard(row);
                RowsList.Children.Add(card);
                if (row.Number == _selectedNumber || (toSelect == null && _selectedNumber == null))
                {
                    toSelect = card;
                    toSelectNumber = row.Number;
                }
            }
            if (toSelect != null) SelectCard(toSelect, toSelectNumber);
        }

        /// <summary>Git #1870 — the toggle's label/colour must make the gate state unmistakable on
        /// its own (green "▶ Free flow" when open, peach "⏸ Gated" when closed), reinforcing the
        /// "· free flow" / "· gated" suffix TxtCount already carries.</summary>
        private void UpdateFreeFlowVisual(bool freeFlow)
        {
            if (freeFlow)
            {
                BtnFreeFlow.Content = "▶ Free flow";
                BtnFreeFlow.Foreground = (Brush)Application.Current.FindResource("GreenBrush");
                BtnFreeFlow.BorderBrush = (Brush)Application.Current.FindResource("GreenBrush");
                BtnFreeFlow.ToolTip = "Free flow is ON — approved Batter Up items auto-queue on every refresh. Click to gate the feed.";
            }
            else
            {
                BtnFreeFlow.Content = "⏸ Gated";
                BtnFreeFlow.Foreground = (Brush)Application.Current.FindResource("PeachBrush");
                BtnFreeFlow.BorderBrush = (Brush)Application.Current.FindResource("Surface1Brush");
                BtnFreeFlow.ToolTip = "Free flow is OFF — nothing auto-queues; queue rows by hand with the card's Queue button. Click to allow free flow.";
            }
        }

        /// <summary>
        /// Git #1870 — queues one listed row by hand (the gated path). Guards a double-click TWO
        /// ways as #1870 requires: the button is disabled on click here, AND
        /// <see cref="Services.BatterUpQueueService.QueueRowAsync"/> re-runs FindDedupCandidateAsync
        /// so even a click that races the 90s refresh can't create a second row. Blocked rows are
        /// queued unchanged — no bypass; they wait in bt_build_queue behind the #1600 watcher.
        /// </summary>
        private async System.Threading.Tasks.Task QueueRowManuallyAsync(Button btn, Services.BatterUpRow r)
        {
            if (_db == null) return;

            btn.IsEnabled = false; // double-click guard #1 (dedup in QueueRowAsync is guard #2)
            var originalContent = btn.Content;
            Services.ActivityLog.Log("batter-up", $"#{r.Number} \"{r.Title}\" — manual queue requested.");

            bool queued;
            try
            {
                queued = await Services.BatterUpQueueService.QueueRowAsync(
                    _db, r, msg => Services.ActivityLog.Log("batter-up", msg),
                    // Git #1997 — a manual Queue click on a row that reappeared because its prior
                    // queue row died (failed/canceled) re-queues that exact row. Explicit click only;
                    // free-flow never sets this, so a failing build can't auto-loop.
                    allowRequeueTerminal: r.TrackedTerminalStatus != null);
            }
            catch (Exception ex)
            {
                Services.ActivityLog.Log("batter-up", $"#{r.Number} — manual queue FAILED: {ex.Message}");
                MessageBox.Show($"Couldn't queue #{r.Number}: {ex.Message}", "Batter Up",
                    MessageBoxButton.OK, MessageBoxImage.Warning);
                btn.Content = originalContent;
                btn.IsEnabled = true;
                return;
            }

            // Immediate feedback rather than a card that looks inert for up to 90s (#1870): mark
            // the button, then refresh — the row drops off on the next list per #1808.
            btn.Content = queued ? "Queued ✓" : "Already queued";
            btn.Foreground = (Brush)Application.Current.FindResource(queued ? "GreenBrush" : "Subtext0Brush");

            if (queued)
            {
                try { RowsAutoQueued?.Invoke(this, EventArgs.Empty); }
                catch { /* best-effort visual refresh of the sibling queue panel */ }
            }

            await RefreshAsync();
        }

        public async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_refreshing) return; // a slow GitHub round-trip shouldn't stack on the next timer tick
            _refreshing = true;
            try
            {
                var settings = Services.BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat)
                {
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    _allRows = new List<Services.BatterUpRow>();
                    UpdateFilterBoxVisibility();
                    TxtEmpty.Text = "No GitHub PAT configured — set one in Settings.";
                    TxtEmpty.Visibility = Visibility.Visible;
                    SetCount(0);
                    return;
                }

                // Git #1870 — read the Free flow gate LIVE every tick (not cached at startup),
                // so toggling it takes effect on the next refresh without a restart. Off (the
                // default) = list only, queue nothing; On = the pre-#1870 auto-queue behaviour.
                bool freeFlow = settings.BatterUpFreeFlow;
                BtnFreeFlow.IsChecked = freeFlow;
                UpdateFreeFlowVisual(freeFlow);

                var gh = new Services.GitHubApiClient(settings.GitHubPat);
                List<Services.BatterUpRow> rows;
                int justQueuedCount = 0;
                int suppressedCount = 0;
                try
                {
                    if (freeFlow)
                    {
                        (rows, justQueuedCount, suppressedCount) = await Services.BatterUpQueueService.RefreshAndAutoQueueAsync(
                            gh, _db, msg => Services.ActivityLog.Log("batter-up", msg));
                    }
                    else
                    {
                        (rows, suppressedCount) = await Services.BatterUpQueueService.RefreshAsync(
                            gh, _db, msg => Services.ActivityLog.Log("batter-up", msg));
                        Services.ActivityLog.Log("batter-up",
                            $"Refresh (Free flow OFF — gated) — {rows.Count} board item(s) listed, none queued" +
                            (suppressedCount > 0 ? $"; {suppressedCount} tracked+hidden." : "."));
                    }
                }
                catch (Exception ex)
                {
                    Services.ActivityLog.Log("batter-up", $"Refresh failed: {ex.Message}");
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    _allRows = new List<Services.BatterUpRow>();
                    UpdateFilterBoxVisibility();
                    TxtEmpty.Text = $"Couldn't read Batter Up: {ex.Message}";
                    TxtEmpty.Visibility = Visibility.Visible;
                    SetCount(0);
                    return;
                }

                // Git #2555 — store the fetched rows and render through the shared
                // filter/sort path (RenderFilteredRows) instead of building cards directly
                // here, so TxtFilter/BtnSortByState apply on this first render too.
                _allRows = rows;
                UpdateFilterBoxVisibility();
                RenderFilteredRows();

                // Git #1816 — the "zero rows" empty state reads inline in the header's
                // TxtCount instead of the separate TxtEmpty block, so an empty panel's
                // footprint never grows past this one header line. Git #1870 — the mode
                // suffix ("· gated" / "· free flow") makes a paused feed unmistakable so
                // Shane never assumes builds are flowing when they aren't.
                string mode = freeFlow ? "free flow" : "gated";
                // Git #1997 — surface the tracked+hidden count so "nothing in this lane" (— none) is
                // distinguishable at a glance from "everything in this lane is hidden" (— none · N
                // tracked, hidden). Without this, a fully-suppressed lane looked identical to an empty
                // one, which is exactly how #1994 went invisible.
                string hidden = suppressedCount > 0 ? $" · {suppressedCount} tracked, hidden" : "";
                TxtCount.Text = (rows.Count == 0 ? $"— none · {mode}" : $"({rows.Count}) · {mode}") + hidden;
                TxtEmpty.Visibility = Visibility.Collapsed;
                SetCount(rows.Count);

                if (justQueuedCount > 0)
                {
                    try { RowsAutoQueued?.Invoke(this, EventArgs.Empty); }
                    catch { /* best-effort visual refresh of the sibling queue panel */ }
                }
            }
            finally
            {
                _refreshing = false;
            }
        }

        /// <summary>
        /// Git #1803 — one Batter Up row, built in the same card shape as
        /// BuildQueuePanel.BuildQueueCard: status pill + issue-number badge on top, title,
        /// blocked/model detail line, and the same critter mascot on the right (mood
        /// Blocked when a real open blocker exists, Normal otherwise — "waiting to be
        /// picked up", the same as a freshly queued item).
        /// </summary>
        private Border BuildBatterUpCard(Services.BatterUpRow r)
        {
            var card = BuildQueuePanel.BuildGenericCardShell(r.IsBlocked);

            var mainStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };

            var topRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };
            topRow.Children.Add(BuildStatusPill(r));

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
                detailParts.Add("no BUILD: comment — not auto-queued");
            }
            mainStack.Children.Add(new TextBlock
            {
                Text = string.Join("  ·  ", detailParts),
                FontSize = 10,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(1, 2, 0, 0)
            });

            if (r.IsBlocked)
            {
                mainStack.Children.Add(new TextBlock
                {
                    // Git #2225 — show what's GENUINELY still holding it (open AND not yet satisfied by a
                    // verified DONE bookend), not every raw-open blocker; a blocker open-but-proven-landed
                    // no longer blocks and shouldn't appear here.
                    Text = $"waiting on #{string.Join(", #", r.BlockingNumbers)}",
                    FontSize = 10,
                    FontStyle = FontStyles.Italic,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                    Margin = new Thickness(1, 2, 0, 0)
                });
            }

            // ── Git #1870 — per-row manual queue action, in the same in-card footer shape
            //    AiBatterUpPanel's Yes/No footer uses (#1803). Disabled with the reason in a
            //    tooltip for a row that has no BUILD: comment (it can't be queued — that stays
            //    true from before). A blocked row IS queueable (it waits in bt_build_queue like
            //    any other, behind the #1600 watcher) — no bypass. ──
            var footer = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(1, 4, 0, 0) };
            var btnQueue = new Button
            {
                Content = "Queue",
                Padding = new Thickness(10, 2, 10, 2),
                Background = (Brush)Application.Current.FindResource("Surface0Brush"),
                Foreground = (Brush)Application.Current.FindResource(r.HasBuildComment ? "GreenBrush" : "Subtext0Brush"),
                BorderBrush = (Brush)Application.Current.FindResource(r.HasBuildComment ? "GreenBrush" : "Surface1Brush"),
                BorderThickness = new Thickness(1),
                Cursor = System.Windows.Input.Cursors.Hand,
                IsEnabled = r.HasBuildComment,
                ToolTip = r.HasBuildComment
                    ? "Queue this build now (enters bt_build_queue; a blocked item waits there until its blockers clear)."
                    : "No BUILD: comment yet — this item cannot be queued until one is added."
            };
            if (r.HasBuildComment)
                btnQueue.Click += async (_, _) => await QueueRowManuallyAsync(btnQueue, r);
            footer.Children.Add(btnQueue);
            mainStack.Children.Add(footer);

            var cardGrid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            Grid.SetColumn(mainStack, 0);
            cardGrid.Children.Add(mainStack);

            var mood = r.IsBlocked ? BuildQueuePanel.CritterMood.Blocked
                : r.JustAutoQueued ? BuildQueuePanel.CritterMood.Done
                : BuildQueuePanel.CritterMood.Normal;
            var mascot = BuildQueuePanel.CreateGenericCardMascot(r.Number, mood, r.IsBlocked);
            Grid.SetColumn(mascot, 1);
            cardGrid.Children.Add(mascot);

            card.Child = cardGrid;

            // Shane, 2026-08-30 — click anywhere on the card (that isn't the Queue button —
            // ButtonBase already marks its own MouseLeftButtonUp Handled, so this bubbling
            // handler never fires for that) to load it into DetailPane.
            card.Cursor = System.Windows.Input.Cursors.Hand;
            card.MouseLeftButtonUp += (_, _) => SelectCard(card, r.Number);

            return card;
        }

        /// <summary>
        /// Highlights <paramref name="card"/> (restoring whatever card was previously
        /// selected to its normal border) and loads its issue into the right-hand
        /// <see cref="DetailPane"/>. Shared by a plain row click and the auto-select
        /// RefreshAsync does on every refresh.
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

        private static Border BuildStatusPill(Services.BatterUpRow r)
        {
            if (!r.HasBuildComment)
                return BuildQueuePanel.BuildStatusPill("NO BUILD",
                    Color.FromRgb(0x21, 0x22, 0x34), Color.FromRgb(0x6C, 0x70, 0x86), Color.FromRgb(0xBA, 0xB4, 0xCD));
            if (r.IsBlocked)
                return BuildQueuePanel.BuildStatusPill("🔒 BLOCKED",
                    Color.FromRgb(0x3A, 0x1E, 0x26), Color.FromRgb(0xF3, 0x8B, 0xA8), Color.FromRgb(0xF3, 0x8B, 0xA8));
            if (r.TrackedTerminalStatus != null)
                // Git #1997 — its queue row died (failed/canceled) and it reappeared here rather than
                // going invisible in both places. Distinct red pill so a dead build reads as needing a
                // re-queue, not as a fresh Up-Next item.
                return BuildQueuePanel.BuildStatusPill(
                    string.Equals(r.TrackedTerminalStatus, "canceled", StringComparison.OrdinalIgnoreCase) ? "↺ CANCELED" : "↺ FAILED",
                    Color.FromRgb(0x3A, 0x1E, 0x26), Color.FromRgb(0xF3, 0x8B, 0xA8), Color.FromRgb(0xF3, 0x8B, 0xA8));
            if (r.JustAutoQueued)
                return BuildQueuePanel.BuildStatusPill("✨ QUEUED",
                    Color.FromRgb(0x1C, 0x35, 0x27), Color.FromRgb(0xA6, 0xE3, 0xA1), Color.FromRgb(0xA6, 0xE3, 0xA1));
            if (r.AlreadyTracked)
                return BuildQueuePanel.BuildStatusPill("TRACKED",
                    Color.FromRgb(0x1D, 0x2E, 0x45), Color.FromRgb(0x89, 0xB4, 0xFA), Color.FromRgb(0x89, 0xB4, 0xFA));
            return BuildQueuePanel.BuildStatusPill("⏳ UP NEXT",
                Color.FromRgb(0x21, 0x22, 0x34), Color.FromRgb(0x6C, 0x70, 0x86), Color.FromRgb(0xBA, 0xB4, 0xCD));
        }
    }
}

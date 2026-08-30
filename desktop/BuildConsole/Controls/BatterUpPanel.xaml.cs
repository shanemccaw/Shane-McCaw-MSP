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
        private System.Windows.Threading.DispatcherTimer? _timer;
        private bool _refreshing;

        // Git #1816 — TxtEmpty is now reserved for the rarer no-PAT/error messages only
        // (the plain "zero rows" case shows inline in TxtCount instead); this tracks
        // whether TxtEmpty currently holds one of those real messages, so BtnCollapse_Click
        // can restore/hide it correctly without re-deriving it from row count.
        private bool _emptyMessageActive;

        /// <summary>Fired after a refresh pass auto-queued one or more rows, so MainWindow can
        /// tell the sibling BuildQueuePanel to repaint — same "best-effort visual refresh"
        /// pattern every other queue-mutating action in this app already follows.</summary>
        public event EventHandler? RowsAutoQueued;

        public BatterUpPanel()
        {
            InitializeComponent();
        }

        /// <summary>Mirrors BuildQueuePanel.Initialize's shape — called once from MainWindow right after BuildQueuePanel.Initialize.</summary>
        public void Initialize(Services.BuildQueuePostgresClient? db)
        {
            _db = db;

            _timer = new System.Windows.Threading.DispatcherTimer
            {
                Interval = TimeSpan.FromSeconds(90),
            };
            _timer.Tick += async (_, _) => await RefreshAsync();
            _timer.Start();

            _ = RefreshAsync();
        }

        private void BtnCollapse_Click(object sender, RoutedEventArgs e)
        {
            bool collapsed = BtnCollapse.IsChecked == true;
            RowsScroller.Visibility = collapsed ? Visibility.Collapsed : Visibility.Visible;
            TxtEmpty.Visibility = (!collapsed && _emptyMessageActive) ? Visibility.Visible : Visibility.Collapsed;
            BtnCollapse.Content = collapsed ? "▸" : "▾";
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
                    _db, r, msg => Services.ActivityLog.Log("batter-up", msg));
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
                    _emptyMessageActive = true;
                    TxtEmpty.Text = "No GitHub PAT configured — set one in Settings.";
                    TxtEmpty.Visibility = Visibility.Visible;
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
                try
                {
                    if (freeFlow)
                    {
                        (rows, justQueuedCount) = await Services.BatterUpQueueService.RefreshAndAutoQueueAsync(
                            gh, _db, msg => Services.ActivityLog.Log("batter-up", msg));
                    }
                    else
                    {
                        rows = await Services.BatterUpQueueService.RefreshAsync(
                            gh, _db, msg => Services.ActivityLog.Log("batter-up", msg));
                        Services.ActivityLog.Log("batter-up",
                            $"Refresh (Free flow OFF — gated) — {rows.Count} board item(s) listed, none queued.");
                    }
                }
                catch (Exception ex)
                {
                    Services.ActivityLog.Log("batter-up", $"Refresh failed: {ex.Message}");
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    _emptyMessageActive = true;
                    TxtEmpty.Text = $"Couldn't read Batter Up: {ex.Message}";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                RowsList.Children.Clear();
                foreach (var row in rows)
                    RowsList.Children.Add(BuildBatterUpCard(row));

                // Git #1816 — the "zero rows" empty state reads inline in the header's
                // TxtCount instead of the separate TxtEmpty block, so an empty panel's
                // footprint never grows past this one header line. Git #1870 — the mode
                // suffix ("· gated" / "· free flow") makes a paused feed unmistakable so
                // Shane never assumes builds are flowing when they aren't.
                string mode = freeFlow ? "free flow" : "gated";
                TxtCount.Text = rows.Count == 0 ? $"— none · {mode}" : $"({rows.Count}) · {mode}";
                _emptyMessageActive = false;
                TxtEmpty.Visibility = Visibility.Collapsed;

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
                    Text = $"waiting on #{string.Join(", #", r.OpenBlockedByNumbers)}",
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
            return card;
        }

        private static Border BuildStatusPill(Services.BatterUpRow r)
        {
            if (!r.HasBuildComment)
                return BuildQueuePanel.BuildStatusPill("NO BUILD",
                    Color.FromRgb(0x21, 0x22, 0x34), Color.FromRgb(0x6C, 0x70, 0x86), Color.FromRgb(0xBA, 0xB4, 0xCD));
            if (r.IsBlocked)
                return BuildQueuePanel.BuildStatusPill("🔒 BLOCKED",
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

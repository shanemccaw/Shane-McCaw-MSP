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
        private Services.GitHubApiClient? _gh;
        private System.Windows.Threading.DispatcherTimer? _timer;
        private bool _refreshing;

        // Git #1816 — TxtEmpty is now reserved for the rarer no-PAT/error messages only
        // (the plain "zero rows" case shows inline in TxtCount instead); this tracks
        // whether TxtEmpty currently holds one of those real messages, so BtnCollapse_Click
        // can restore/hide it correctly without re-deriving it from row count.
        private bool _emptyMessageActive;

        // Git #1863 — the real fetched/sorted rows from the last RefreshAsync. TxtFilter
        // narrows what's rendered from this list; it never touches what's fetched or the
        // Yes/No board mutations, which always operate on the row object already in hand.
        private List<Services.AiBatterUpRow> _allRows = new();

        public AiBatterUpPanel()
        {
            InitializeComponent();
        }

        /// <summary>Called once from MainWindow right after BatterUpPanel.Initialize.</summary>
        public void Initialize()
        {
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
            UpdateFilterBoxVisibility();
        }

        // Git #1863 — the filter box shows only when there's something to filter: rows
        // fetched (not the "none open" / no-PAT / error states) AND the panel expanded.
        // Collapsing the panel hides it right along with the rows, per #1816.
        private void UpdateFilterBoxVisibility()
        {
            bool collapsed = BtnCollapse.IsChecked == true;
            FilterBoxHost.Visibility = (!collapsed && _allRows.Count > 0) ? Visibility.Visible : Visibility.Collapsed;
        }

        private Services.GitHubApiClient? GetClient()
        {
            var settings = Services.BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat) return null;
            return _gh ??= new Services.GitHubApiClient(settings.GitHubPat);
        }

        public async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_refreshing) return; // a slow GitHub round-trip shouldn't stack on the next timer tick
            _refreshing = true;
            try
            {
                var gh = GetClient();
                if (gh == null)
                {
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    _allRows = new List<Services.AiBatterUpRow>();
                    UpdateFilterBoxVisibility();
                    _emptyMessageActive = true;
                    TxtEmpty.Text = "No GitHub PAT configured — set one in Settings.";
                    TxtEmpty.Visibility = Visibility.Visible;
                    return;
                }

                List<Services.AiBatterUpRow> rows;
                try
                {
                    rows = await Services.AiBatterUpQueueService.RefreshAsync(gh);
                }
                catch (Exception ex)
                {
                    Services.ActivityLog.Log("ai-batter-up", $"Refresh failed: {ex.Message}");
                    TxtCount.Text = "";
                    RowsList.Children.Clear();
                    _allRows = new List<Services.AiBatterUpRow>();
                    UpdateFilterBoxVisibility();
                    _emptyMessageActive = true;
                    TxtEmpty.Text = $"Couldn't read AI Batter Up: {ex.Message}";
                    TxtEmpty.Visibility = Visibility.Visible;
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
                _emptyMessageActive = false;
                TxtEmpty.Visibility = Visibility.Collapsed;
                UpdateFilterBoxVisibility();
                RenderFilteredRows();
            }
            finally
            {
                _refreshing = false;
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

            foreach (var row in visibleList)
                RowsList.Children.Add(BuildAiBatterUpCard(row));
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
                if (promote)
                    await Services.AiBatterUpQueueService.PromoteToBatterUpAsync(gh, r.ItemId);
                else
                    await Services.AiBatterUpQueueService.DemoteToBacklogAsync(gh, r.ItemId);

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
            return card;
        }
    }
}

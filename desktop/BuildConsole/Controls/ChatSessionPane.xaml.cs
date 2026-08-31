using System;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// design_handoff_claude_cli_chat/README.md's chat session pane, implemented as a
    /// self-contained UserControl bound to a <see cref="ChatPaneViewModel"/>. Owns its own
    /// composer (auto-grow TextBox, Send/Stop, @path autocomplete) and raises events for
    /// BuildWatchWindow to wire into the real interactive build (SendInput/RequestStopAsync)
    /// — this control has no knowledge of QueueWatcherService itself.
    /// </summary>
    public partial class ChatSessionPane : UserControl
    {
        public ChatPaneViewModel ViewModel { get; } = new();

        /// <summary>The build's working directory, set by the host — powers @path autocomplete. Null/missing directory just means no suggestions (graceful degrade, matches the original behavior).</summary>
        public string? Cwd { get; set; }

        public event Action<string>? SendRequested;
        public event Action? StopRequested;
        public event Action? DismissRequested;
        /// <summary>Git #1878 — "▶ Resume Session" clicked from the AdoptedReadOnly composer note. The host
        /// (BuildWatchWindow slot / GitDetailView build pane) owns the queue item's real fields, so it performs
        /// the actual QueueBuildAsync resume dispatch — this control has no knowledge of the queue itself.</summary>
        public event Action? ResumeRequested;

        private Popup? _autoCompletePopup;
        private ListBox? _autoCompleteList;
        private bool _stickToBottom = true;

        public ChatSessionPane()
        {
            InitializeComponent();
            DataContext = ViewModel;
            BuildAutoCompletePopup();

            // Live-refresh this build's own progress column off BuildProgressTracker.
            Loaded += (_, _) =>
            {
                BuildProgressTracker.ProgressChanged += OnProgressChanged;
                RefreshProgress();

                // Git #1206 — ProgressChanged only fires when an agent actually reports. When a
                // session goes quiet after its first checkpoint, no event ever arrives, so the panel
                // would sit frozen with no signal. This low-frequency tick re-evaluates staleness off
                // wall-clock time (not new reports) so a quiet build surfaces a "no update in Xm"
                // notice on its own. It only touches the stale badge — cheap, no history rebuild.
                if (_stalenessTimer == null)
                {
                    _stalenessTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
                    _stalenessTimer.Tick += (_, _) => RefreshStaleness();
                }
                _stalenessTimer.Start();
            };
            Unloaded += (_, _) =>
            {
                BuildProgressTracker.ProgressChanged -= OnProgressChanged;
                _stalenessTimer?.Stop();
            };
        }

        private DispatcherTimer? _stalenessTimer;

        // ── This build's own Explicit Progress & ETA column ─────────────────
        private int _checklistBuildId;

        /// <summary>Points this pane's progress column at a specific build (its queue id), or 0 to unbind and hide it.</summary>
        public void SetChecklistBuild(int queueItemId)
        {
            _checklistBuildId = queueItemId;
            RefreshProgress();
        }

        private void OnProgressChanged(BuildProgressReport report)
        {
            if (report.QueueItemId == _checklistBuildId)
            {
                RefreshProgress();
            }
        }

        /// <summary>
        /// Rebuilds this build's explicit progress panel from BuildProgressTracker.
        /// </summary>
        private void RefreshProgress()
        {
            if (_checklistBuildId == 0)
            {
                ProgressPanel.Visibility = Visibility.Collapsed;
                ProgressHistoryRows.Children.Clear();
                return;
            }

            var report = BuildProgressTracker.GetProgress(_checklistBuildId);
            if (report == null || report.Total <= 0)
            {
                ProgressPanel.Visibility = Visibility.Collapsed;
                ProgressHistoryRows.Children.Clear();
                return;
            }

            ProgressPanel.Visibility = Visibility.Visible;
            ProgressPercentText.Text = $"{report.Step}/{report.Total} ({report.Percent:0}%)";
            ProgressBarIndicator.Value = report.Percent;
            CurrentStepLabelText.Text = string.IsNullOrWhiteSpace(report.CurrentLabel) ? $"Step {report.Step} of {report.Total}" : report.CurrentLabel;
            EtaRemainingText.Text = report.EstimatedRemainingText;

            ProgressHistoryRows.Children.Clear();
            for (int i = 0; i < report.History.Count; i++)
            {
                var h = report.History[i];
                ProgressHistoryRows.Children.Add(BuildProgressStepRow(h, i == report.History.Count - 1));
            }

            // A fresh report just landed — clear/refresh the stale notice immediately.
            RefreshStaleness();
        }

        /// <summary>
        /// Git #1206 — updates only the soft "no progress update in Xm" notice, off wall-clock time.
        /// Driven both by a fresh report (end of <see cref="RefreshProgress"/>) and by a low-frequency
        /// timer, so a build that stops reporting after its first checkpoint reads as honestly-stale
        /// instead of looking frozen with no signal. Never forces the agent to report — display only.
        /// </summary>
        private void RefreshStaleness()
        {
            if (StaleNoticeText == null) return;

            if (_checklistBuildId == 0)
            {
                StaleNoticeText.Visibility = Visibility.Collapsed;
                return;
            }

            var report = BuildProgressTracker.GetProgress(_checklistBuildId);
            if (report == null || report.Total <= 0 || !report.IsStale)
            {
                StaleNoticeText.Visibility = Visibility.Collapsed;
                return;
            }

            StaleNoticeText.Text = "⚠ " + report.StalenessText;
            StaleNoticeText.Visibility = Visibility.Visible;
        }

        /// <summary>One step row: ✔ for completed step, ⏳ for current active step.</summary>
        private UIElement BuildProgressStepRow(ProgressStepEntry entry, bool isLatest)
        {
            var grid = new Grid { Margin = new Thickness(0, 3, 0, 3) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            string glyphText = isLatest ? "⏳" : "✔";
            var glyph = new TextBlock
            {
                Text = glyphText,
                FontSize = 11,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Top,
                Foreground = isLatest ? (Brush)FindResource("YellowBrush") : (Brush)FindResource("GreenBrush"),
            };
            Grid.SetColumn(glyph, 0);
            grid.Children.Add(glyph);

            var sp = new StackPanel();
            var text = new TextBlock
            {
                Text = entry.Label,
                FontSize = 10.5,
                TextWrapping = TextWrapping.Wrap,
                Foreground = isLatest ? (Brush)FindResource("TextBrush") : (Brush)FindResource("Subtext1Brush"),
                FontWeight = isLatest ? FontWeights.SemiBold : FontWeights.Normal
            };
            sp.Children.Add(text);

            if (entry.ElapsedSinceStart.TotalSeconds > 0)
            {
                var timeText = new TextBlock
                {
                    Text = $"+{(int)entry.ElapsedSinceStart.TotalMinutes}m {entry.ElapsedSinceStart.Seconds}s",
                    FontSize = 9.5,
                    Foreground = (Brush)FindResource("Subtext0Brush")
                };
                sp.Children.Add(timeText);
            }

            Grid.SetColumn(sp, 1);
            grid.Children.Add(sp);
            return grid;
        }

        // ── Auto-scroll: stick to bottom only while already near it (README: "do not use forced scroll-into-view") ──
        private void TranscriptScroll_ScrollChanged(object sender, ScrollChangedEventArgs e)
        {
            if (e.ExtentHeightChange == 0)
            {
                double distanceFromBottom = e.ExtentHeight - e.VerticalOffset - e.ViewportHeight;
                _stickToBottom = distanceFromBottom <= 40;
            }
            else if (_stickToBottom)
            {
                TranscriptScroll.ScrollToEnd();
            }
        }

        // ── Tool-group expand/collapse ──────────────────────────────────
        private void ToolGroupHeader_Click(object sender, RoutedEventArgs e)
        {
            if ((sender as FrameworkElement)?.DataContext is ToolGroupTurn group)
                group.IsExpanded = !group.IsExpanded;
        }

        // ── Copy — right-click "Copy" on transcript blocks, since the plain TextBlocks here
        // don't support click-and-drag selection or Ctrl+C on their own. ──
        private void CopyBlockText_Click(object sender, RoutedEventArgs e)
        {
            if (sender is MenuItem { Parent: ContextMenu { PlacementTarget: TextBlock tb } })
            {
                var text = tb.Text;
                if (!string.IsNullOrEmpty(text)) Clipboard.SetText(text);
            }
        }

        /// <summary>Copies a whole tool-call detail (name, real command, real diff, real output) as one block — the right-click target is the detail's own StackPanel, whose DataContext is its <see cref="ToolDetailLine"/>.</summary>
        private void CopyToolDetail_Click(object sender, RoutedEventArgs e)
        {
            if (sender is not MenuItem { Parent: ContextMenu { PlacementTarget: FrameworkElement fe } } ||
                fe.DataContext is not ToolDetailLine detail) return;

            var sb = new StringBuilder(detail.ToolName);
            if (detail.HasCommand) sb.Append("  ").Append(detail.CommandPreview);
            if (detail.HasDiff)
            {
                sb.AppendLine();
                foreach (var line in detail.Diff!) sb.AppendLine(line.Text);
            }
            if (detail.HasOutput)
            {
                sb.AppendLine();
                sb.Append(detail.Output);
            }
            Clipboard.SetText(sb.ToString());
        }

        // ── Composer: send / stop / dismiss / resume ─────────────────────
        private void SendButton_Click(object sender, RoutedEventArgs e) => TrySend();
        private void StopButton_Click(object sender, RoutedEventArgs e) => StopRequested?.Invoke();
        private void DismissButton_Click(object sender, RoutedEventArgs e) => DismissRequested?.Invoke();
        private void ResumeButton_Click(object sender, RoutedEventArgs e) => ResumeRequested?.Invoke();

        private void TrySend()
        {
            if (!ViewModel.CanSend) return;
            CloseAutoComplete();
            var text = ViewModel.Draft;
            ViewModel.Draft = "";
            SendRequested?.Invoke(text);
        }

        private void ComposerBox_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (_autoCompletePopup?.IsOpen == true && _autoCompleteList != null && _autoCompleteList.Items.Count > 0)
            {
                switch (e.Key)
                {
                    case Key.Down:
                        _autoCompleteList.SelectedIndex = Math.Min(_autoCompleteList.SelectedIndex + 1, _autoCompleteList.Items.Count - 1);
                        _autoCompleteList.ScrollIntoView(_autoCompleteList.SelectedItem);
                        e.Handled = true; return;
                    case Key.Up:
                        _autoCompleteList.SelectedIndex = Math.Max(_autoCompleteList.SelectedIndex - 1, 0);
                        _autoCompleteList.ScrollIntoView(_autoCompleteList.SelectedItem);
                        e.Handled = true; return;
                    case Key.Tab:
                    case Key.Enter:
                        AcceptAutoComplete(); e.Handled = true; return;
                    case Key.Escape:
                        CloseAutoComplete(); e.Handled = true; return;
                }
            }

            if (e.Key == Key.Enter && (Keyboard.Modifiers & ModifierKeys.Shift) == 0)
            {
                TrySend();
                e.Handled = true;
            }
        }

        private void ComposerBox_TextChanged(object sender, TextChangedEventArgs e) => UpdateAutoComplete();
        private void ComposerBox_LostKeyboardFocus(object sender, RoutedEventArgs e) => CloseAutoComplete();

        // ── @path autocomplete (bonus; degrades to nothing when Cwd is unknown) ──
        private void BuildAutoCompletePopup()
        {
            _autoCompleteList = new ListBox
            {
                MaxHeight = 160,
                Background = (Brush)FindResource("ChatPane.Surface"),
                Foreground = (Brush)FindResource("ChatPane.Text3"),
                BorderThickness = new Thickness(0),
                FontSize = 12.5,
            };
            _autoCompleteList.PreviewMouseLeftButtonUp += (s, e) => AcceptAutoComplete();
            _autoCompletePopup = new Popup
            {
                PlacementTarget = ComposerBox,
                Placement = PlacementMode.Top,
                StaysOpen = false,
                AllowsTransparency = true,
                MinWidth = 180,
                Child = new Border
                {
                    Background = (Brush)FindResource("ChatPane.Surface"),
                    BorderBrush = (Brush)FindResource("ChatPane.BorderStrong"),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(6),
                    Child = _autoCompleteList,
                },
            };
        }

        private void UpdateAutoComplete()
        {
            if (_autoCompletePopup == null || _autoCompleteList == null) return;
            var frag = PathAutocomplete.CurrentAtFragment(ComposerBox);
            if (frag == null || string.IsNullOrEmpty(Cwd) || !Directory.Exists(Cwd))
            {
                CloseAutoComplete();
                return;
            }
            var matches = PathAutocomplete.MatchPaths(Cwd!, frag);
            if (matches.Count == 0) { CloseAutoComplete(); return; }
            _autoCompleteList.ItemsSource = matches;
            _autoCompleteList.SelectedIndex = 0;
            _autoCompletePopup.IsOpen = true;
        }

        private void CloseAutoComplete()
        {
            if (_autoCompletePopup != null) _autoCompletePopup.IsOpen = false;
        }

        private void AcceptAutoComplete()
        {
            if (_autoCompleteList?.SelectedItem is not string pick) { CloseAutoComplete(); return; }
            int caret = Math.Min(ComposerBox.CaretIndex, (ComposerBox.Text ?? "").Length);
            string text = ComposerBox.Text ?? "";
            string upto = text.Substring(0, caret);
            int at = upto.LastIndexOf('@');
            if (at < 0) { CloseAutoComplete(); return; }
            string before = text.Substring(0, at + 1); // keep the '@'
            string after = text.Substring(caret);
            ComposerBox.Text = before + pick + after;
            ComposerBox.CaretIndex = (before + pick).Length;
            CloseAutoComplete();
            ComposerBox.Focus();
        }
    }
}

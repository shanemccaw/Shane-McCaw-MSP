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

        private Popup? _autoCompletePopup;
        private ListBox? _autoCompleteList;
        private bool _stickToBottom = true;

        public ChatSessionPane()
        {
            InitializeComponent();
            DataContext = ViewModel;
            BuildAutoCompletePopup();

            // Live-refresh this build's own checklist column off the shared tracker. Subscribe on
            // Loaded / unsubscribe on Unloaded (the exact pattern FocusModeBar uses) so a closed
            // Build Watch window's panes don't linger attached to the app-wide singleton.
            Loaded += (_, _) => { TaskChecklistViewModel.Shared.PropertyChanged += OnSharedChecklistChanged; RefreshChecklist(); };
            Unloaded += (_, _) => { TaskChecklistViewModel.Shared.PropertyChanged -= OnSharedChecklistChanged; };
        }

        // ── This build's own Task Checklist column (Git #42/#56) ─────────────────
        // Renders ONLY this pane's build's checklist — the same real items #56 detects
        // (structured TaskCreate/TaskUpdate) plus #28's free-form ☐ / "- [ ]" text fallback —
        // read straight from the shared TaskChecklistViewModel and filtered to this build's
        // queue id. The old single global panel that merged every build's items into one flat
        // list is gone; each build now shows only its own steps, in its own square. Focus Mode's
        // band still reads the same shared model, unchanged.

        /// <summary>The queue id whose checklist this pane shows, or 0 when unbound (column hidden). Set by BuildWatchWindow when a slot is occupied / freed.</summary>
        private int _checklistBuildId;
        /// <summary>Cheap guard so we skip the row rebuild when nothing in THIS build's slice changed — the shared tracker fires PropertyChanged on every ingest, most of which don't touch our build.</summary>
        private string _checklistSignature = "";

        /// <summary>Points this pane's checklist column at a specific build (its queue id), or 0 to unbind and hide it. Called by BuildWatchWindow on occupy / clear.</summary>
        public void SetChecklistBuild(int queueItemId)
        {
            _checklistBuildId = queueItemId;
            _checklistSignature = "";   // force a rebuild for the newly-bound build
            RefreshChecklist();
        }

        private void OnSharedChecklistChanged(object? sender, PropertyChangedEventArgs e) => RefreshChecklist();

        /// <summary>
        /// Rebuilds this build's checklist rows from the shared tracker, filtered to <see cref="_checklistBuildId"/>.
        /// Hidden entirely when unbound or this build has reported nothing. A signature guard (state + text of this
        /// build's items) skips the visual rebuild when this build's slice is unchanged — a Done flip changes the
        /// signature, so it re-renders; an unrelated build's ingest does not.
        /// </summary>
        private void RefreshChecklist()
        {
            if (_checklistBuildId == 0)
            {
                ChecklistPanel.Visibility = Visibility.Collapsed;
                _checklistSignature = "";
                ChecklistRows.Children.Clear();
                return;
            }

            var items = TaskChecklistViewModel.Shared.Items
                .Where(it => it.QueueItemId == _checklistBuildId)
                .ToList();

            if (items.Count == 0)
            {
                ChecklistPanel.Visibility = Visibility.Collapsed;
                _checklistSignature = "";
                ChecklistRows.Children.Clear();
                return;
            }

            var sig = string.Join("|", items.Select(i => (i.Done ? "1" : "0") + i.Text));
            if (sig == _checklistSignature) { ChecklistPanel.Visibility = Visibility.Visible; return; }
            _checklistSignature = sig;

            int done = items.Count(i => i.Done);
            ChecklistSummaryText.Text = $"{done}/{items.Count} done";

            ChecklistRows.Children.Clear();
            foreach (var it in items) ChecklistRows.Children.Add(BuildChecklistRow(it));
            ChecklistPanel.Visibility = Visibility.Visible;
        }

        /// <summary>One step row: hollow-box glyph while pending, a real green ✔ + strikethrough once the agent
        /// reports it done — the exact visual language of #28's Task Checklist panel and Focus Mode's band.</summary>
        private UIElement BuildChecklistRow(ChecklistItemViewModel it)
        {
            var grid = new Grid { Margin = new Thickness(0, 3, 0, 0) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var glyph = new TextBlock
            {
                Text = it.Glyph,
                FontSize = 11.5,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Top,
                Foreground = (Brush)FindResource(it.Done ? "GreenBrush" : "Subtext1Brush"),
            };
            Grid.SetColumn(glyph, 0);
            grid.Children.Add(glyph);

            var text = new TextBlock
            {
                Text = it.Text,
                FontSize = 11,
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource(it.Done ? "Subtext1Brush" : "TextBrush"),
                TextDecorations = it.Done ? TextDecorations.Strikethrough : null,
            };
            Grid.SetColumn(text, 1);
            grid.Children.Add(text);

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

        // ── Composer: send / stop / dismiss ─────────────────────────────
        private void SendButton_Click(object sender, RoutedEventArgs e) => TrySend();
        private void StopButton_Click(object sender, RoutedEventArgs e) => StopRequested?.Invoke();
        private void DismissButton_Click(object sender, RoutedEventArgs e) => DismissRequested?.Invoke();

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

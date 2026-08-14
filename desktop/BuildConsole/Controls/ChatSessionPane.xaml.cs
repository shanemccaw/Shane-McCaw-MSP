using System;
using System.IO;
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

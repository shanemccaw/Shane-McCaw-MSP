using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #973 — Shane: "Can we use the WebView2 DOM to auto-schedule LinkedIn
    /// posts... I was more thinking a pre-fill and then I'd press the actual
    /// schedule button." An always-on-top (Topmost) LinkedIn post composer
    /// floaty, the same shape as the #937 Sticky Notes window — its own
    /// top-level Window, independent of which editor tab/pane has focus. Shane
    /// writes/pastes the post here and clicks "Send to LinkedIn"; MainWindow
    /// (which owns the WebView2 panes) injects the text into LinkedIn's real
    /// compose box via the #871 native-setter + #922 dispatch-events technique
    /// and NEVER presses Schedule/Post — Shane completes that himself in
    /// LinkedIn's own UI. Draft text + position/size persist to
    /// BuildConsoleSettings (same local %AppData% store as every other setting),
    /// auto-saved debounced so a stray close can't lose a draft. The Send button
    /// does no injection itself — it raises <see cref="SendRequested"/> and
    /// MainWindow reports back through <see cref="ShowInlineMessage"/>.
    /// </summary>
    public partial class LinkedInComposerWindow : Window
    {
        /// <summary>Raised when Send is clicked with non-empty post text. Payload = the post text. MainWindow handles the actual LinkedIn composer injection.</summary>
        public event EventHandler<string>? SendRequested;

        private readonly DispatcherTimer _saveDebounce;
        private bool _loaded;

        public LinkedInComposerWindow()
        {
            InitializeComponent();

            // Debounced auto-save of the draft (600ms matches the app's other
            // debounces — Sticky Notes #937, ChatButtonInjector scan) so an
            // accidental close never loses a post Shane is mid-way through.
            _saveDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
            _saveDebounce.Tick += (s, e) =>
            {
                _saveDebounce.Stop();
                PersistText();
            };

            var settings = BuildConsoleSettings.Load();
            PostBox.Text = settings.LinkedInComposerText ?? "";

            // Restore last position/size. Width/Height always carry real values;
            // Left/Top use -1 as the "never positioned yet" sentinel -> center.
            if (settings.LinkedInComposerWidth > 0) Width = settings.LinkedInComposerWidth;
            if (settings.LinkedInComposerHeight > 0) Height = settings.LinkedInComposerHeight;
            if (settings.LinkedInComposerLeft >= 0 && settings.LinkedInComposerTop >= 0)
            {
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = settings.LinkedInComposerLeft;
                Top = settings.LinkedInComposerTop;
            }
            else
            {
                WindowStartupLocation = WindowStartupLocation.CenterScreen;
            }

            Loaded += (s, e) => _loaded = true;
            LocationChanged += (s, e) => PersistBounds();
            SizeChanged += (s, e) => PersistBounds();
        }

        /// <summary>The current post text (read by MainWindow's Send handler).</summary>
        public string PostText => PostBox.Text;

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            // Drag the borderless window by its header strip.
            try { DragMove(); } catch { /* DragMove throws if the button was already released */ }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();

        private void PostBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            // Restart the debounce on every keystroke — persists once typing pauses.
            _saveDebounce.Stop();
            _saveDebounce.Start();
        }

        private void BtnSend_Click(object sender, RoutedEventArgs e)
        {
            var text = PostBox.Text;
            if (string.IsNullOrWhiteSpace(text))
            {
                ShowInlineMessage("Nothing to send — the post is empty.", isError: true);
                return;
            }
            SendRequested?.Invoke(this, text);
        }

        /// <summary>Shows a one-line inline message under the draft (green-ish for success, red for error). MainWindow calls this back after a Send.</summary>
        public void ShowInlineMessage(string message, bool isError)
        {
            InlineMessage.Text = message;
            InlineMessage.Foreground = (Brush)FindResource(isError ? "RedBrush" : "GreenBrush");
            InlineMessage.Visibility = Visibility.Visible;
        }

        private void PersistText()
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.LinkedInComposerText = PostBox.Text;
                settings.Save();
            }
            catch { /* best-effort auto-save; never let a settings write crash typing */ }
        }

        private void PersistBounds()
        {
            if (!_loaded) return; // ignore the moves/resizes that happen during initial restore
            if (WindowState != WindowState.Normal) return;
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.LinkedInComposerLeft = Left;
                settings.LinkedInComposerTop = Top;
                settings.LinkedInComposerWidth = Width;
                settings.LinkedInComposerHeight = Height;
                settings.Save();
            }
            catch { /* best-effort */ }
        }
    }
}

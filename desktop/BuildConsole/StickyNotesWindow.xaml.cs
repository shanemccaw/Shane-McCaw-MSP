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
    /// Git #937 (Epic #803) — Shane: "a floaty sticky notes. Something I can
    /// use when I'm doing things to take notes for... Then I should be able to
    /// send what I note down into a Claude chat that I'm typing into now."
    /// A genuine always-on-top (Topmost) floating window, independent of which
    /// editor tab/pane has focus in MainWindow — it isn't hosted inside any
    /// pane, it's its own top-level Window, so tab switches never affect it.
    /// Position/size + note text persist to BuildConsoleSettings (same local
    /// %AppData% store as every other setting); the text auto-saves debounced
    /// as Shane types so an accidental close can't lose anything. The Send
    /// button itself does no injection — MainWindow owns the WebView2 panes, so
    /// this raises <see cref="SendRequested"/> and MainWindow does the work and
    /// calls back <see cref="ShowInlineMessage"/> / <see cref="ClearNoteText"/>.
    /// </summary>
    public partial class StickyNotesWindow : Window
    {
        /// <summary>Raised when Send is clicked with non-empty note text. Payload = the note text. MainWindow handles the actual composer injection.</summary>
        public event EventHandler<string>? SendRequested;

        private readonly DispatcherTimer _saveDebounce;
        private bool _loaded;

        public StickyNotesWindow()
        {
            InitializeComponent();

            // Debounced auto-save of the note text (Git #937 — "so an accidental
            // close doesn't lose anything"). 600ms matches the app's other
            // debounces (ChatButtonInjector scan, LeftSidebar width recompute).
            _saveDebounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(600) };
            _saveDebounce.Tick += (s, e) =>
            {
                _saveDebounce.Stop();
                PersistText();
            };

            var settings = BuildConsoleSettings.Load();
            NotesBox.Text = settings.StickyNotesText ?? "";

            // Restore last position/size. Width/Height always carry real values;
            // Left/Top use -1 as the "never positioned yet" sentinel -> center.
            if (settings.StickyNotesWidth > 0) Width = settings.StickyNotesWidth;
            if (settings.StickyNotesHeight > 0) Height = settings.StickyNotesHeight;
            if (settings.StickyNotesLeft >= 0 && settings.StickyNotesTop >= 0)
            {
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = settings.StickyNotesLeft;
                Top = settings.StickyNotesTop;
            }
            else
            {
                WindowStartupLocation = WindowStartupLocation.CenterScreen;
            }

            Loaded += (s, e) => _loaded = true;
            LocationChanged += (s, e) => PersistBounds();
            SizeChanged += (s, e) => PersistBounds();
        }

        /// <summary>The current note text (read by MainWindow's Send handler).</summary>
        public string NoteText => NotesBox.Text;

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            // Drag the borderless window by its header strip.
            try { DragMove(); } catch { /* DragMove throws if the button was already released */ }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e) => Close();

        private void NotesBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            // Restart the debounce on every keystroke — persists once typing pauses.
            _saveDebounce.Stop();
            _saveDebounce.Start();
        }

        private void BtnSend_Click(object sender, RoutedEventArgs e)
        {
            var text = NotesBox.Text;
            if (string.IsNullOrWhiteSpace(text))
            {
                ShowInlineMessage("Nothing to send — the note is empty.", isError: true);
                return;
            }
            SendRequested?.Invoke(this, text);
        }

        /// <summary>Shows a one-line inline message under the note (green-ish for success, red for error). MainWindow calls this back after a Send.</summary>
        public void ShowInlineMessage(string message, bool isError)
        {
            InlineMessage.Text = message;
            InlineMessage.Foreground = (Brush)FindResource(isError ? "RedBrush" : "GreenBrush");
            InlineMessage.Visibility = Visibility.Visible;
        }

        /// <summary>Clears the note text (Git #937 — Shane: "Send = Done, notes clear after sending") and persists that immediately.</summary>
        public void ClearNoteText()
        {
            NotesBox.Clear();
            _saveDebounce.Stop();
            PersistText();
        }

        private void PersistText()
        {
            try
            {
                var settings = BuildConsoleSettings.Load();
                settings.StickyNotesText = NotesBox.Text;
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
                settings.StickyNotesLeft = Left;
                settings.StickyNotesTop = Top;
                settings.StickyNotesWidth = Width;
                settings.StickyNotesHeight = Height;
                settings.Save();
            }
            catch { /* best-effort */ }
        }
    }
}

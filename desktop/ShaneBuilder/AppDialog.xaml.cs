using System.Windows;
using System.Windows.Input;
using ShaneBuilder.Services;

namespace ShaneBuilder
{
    /// <summary>Icon shown next to the message. Mirrors BuildConsole's AppDialogIcon (#2175) —
    /// the handful of icon intents a real call site needs (Error/Warning/Info/Question).</summary>
    public enum AppDialogIcon
    {
        None,
        Info,
        Warning,
        Error,
        Question,
    }

    /// <summary>Which buttons a Confirm dialog shows.</summary>
    public enum AppDialogButtons
    {
        YesNo,
        YesNoCancel,
    }

    /// <summary>
    /// Git #2179 — real custom-chrome dialog (WindowChromeHelper pattern, #2147 tokens)
    /// for ShaneBuilder, so future ShaneBuilder code has a real alternative to native
    /// <c>MessageBox.Show</c> before it ever needs one. Static call-site API only —
    /// <see cref="Alert"/>, <see cref="Confirm"/>, <see cref="Input"/>.
    /// </summary>
    public partial class AppDialog : Window
    {
        private bool _confirmed;

        private AppDialog()
        {
            InitializeComponent();
        }

        protected override void OnSourceInitialized(System.EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        private static void ApplyIcon(AppDialog dlg, AppDialogIcon icon)
        {
            if (icon == AppDialogIcon.None)
            {
                dlg.IconGlyph.Visibility = Visibility.Collapsed;
                return;
            }

            dlg.IconGlyph.Visibility = Visibility.Visible;
            string glyph;
            string brushKey;
            switch (icon)
            {
                case AppDialogIcon.Error:
                    glyph = ""; // ErrorBadge
                    brushKey = "Brush.Toast.Error";
                    break;
                case AppDialogIcon.Warning:
                    glyph = ""; // Warning
                    brushKey = "Brush.Toast.Warning";
                    break;
                case AppDialogIcon.Question:
                    glyph = ""; // Help
                    brushKey = "Brush.Accent.Primary";
                    break;
                default: // Info
                    glyph = ""; // Info
                    brushKey = "Brush.Toast.Info";
                    break;
            }
            dlg.IconGlyph.Text = glyph;
            dlg.IconGlyph.Foreground = (System.Windows.Media.Brush)dlg.FindResource(brushKey);
        }

        /// <summary>OK-only informational/error dialog. Direct replacement for
        /// <c>MessageBox.Show(message, title, MessageBoxButton.OK, image)</c>.</summary>
        public static void Alert(Window? owner, string message, string title, AppDialogIcon icon = AppDialogIcon.Info)
        {
            var dlg = new AppDialog { Owner = owner };
            if (owner != null) dlg.ShowInTaskbar = false;
            dlg.TitleText.Text = title;
            dlg.MessageText.Text = message;
            dlg.BtnPrimary.Content = "OK";
            ApplyIcon(dlg, icon);
            dlg.ShowDialog();
        }

        /// <summary>Yes/No (or Yes/No/Cancel) confirmation. Returns true only for an explicit
        /// Yes click — direct replacement for
        /// <c>MessageBox.Show(...) != MessageBoxResult.Yes</c> guard-return call sites.
        /// A Cancel or a closed window (Alt+F4, title-bar close) also returns false.</summary>
        public static bool Confirm(Window? owner, string message, string title,
            AppDialogButtons buttons = AppDialogButtons.YesNo, AppDialogIcon icon = AppDialogIcon.Question)
        {
            var dlg = new AppDialog { Owner = owner };
            if (owner != null) dlg.ShowInTaskbar = false;
            dlg.TitleText.Text = title;
            dlg.MessageText.Text = message;
            dlg.BtnPrimary.Content = "Yes";
            dlg.BtnNo.Visibility = Visibility.Visible;
            if (buttons == AppDialogButtons.YesNoCancel)
                dlg.BtnCancel.Visibility = Visibility.Visible;
            ApplyIcon(dlg, icon);
            dlg.ShowDialog();
            return dlg._confirmed;
        }

        /// <summary>Simple single-line text-input dialog. Returns the entered text, or null if
        /// canceled/closed without confirming.</summary>
        public static string? Input(Window? owner, string message, string title, string defaultText = "")
        {
            var dlg = new AppDialog { Owner = owner };
            if (owner != null) dlg.ShowInTaskbar = false;
            dlg.TitleText.Text = title;
            dlg.MessageText.Text = message;
            dlg.BtnPrimary.Content = "OK";
            dlg.BtnCancel.Visibility = Visibility.Visible;
            dlg.InputTextBox.Visibility = Visibility.Visible;
            dlg.InputTextBox.Text = defaultText;
            dlg.Loaded += (_, _) =>
            {
                dlg.InputTextBox.Focus();
                dlg.InputTextBox.SelectAll();
            };
            ApplyIcon(dlg, AppDialogIcon.None);
            dlg.ShowDialog();
            return dlg._confirmed ? dlg.InputTextBox.Text : null;
        }

        private void BtnPrimary_Click(object sender, RoutedEventArgs e)
        {
            _confirmed = true;
            Close();
        }

        private void BtnNo_Click(object sender, RoutedEventArgs e)
        {
            _confirmed = false;
            Close();
        }

        private void BtnCancel_Click(object sender, RoutedEventArgs e)
        {
            _confirmed = false;
            Close();
        }

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e)
        {
            _confirmed = false;
            Close();
        }

        private void InputTextBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                _confirmed = true;
                Close();
            }
        }

        private void Window_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape)
            {
                _confirmed = false;
                Close();
            }
        }
    }
}

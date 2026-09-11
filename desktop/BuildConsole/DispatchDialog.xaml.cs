using System;
using System.Windows;
using System.Windows.Input;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #3553 — the modal frame DispatchPanel (Git #1779) now lives inside, opened via a
    /// global Ctrl+D shortcut instead of sitting permanently DockPanel.Dock="Top" above the
    /// Build Queue panel. MainWindow owns exactly one DispatchPanel instance for the app's whole
    /// lifetime (created once, Initialize'd once, same as before this change) and re-parents it
    /// into a fresh DispatchDialog each time Ctrl+D is pressed; ContentHost.Content is cleared on
    /// close so the panel detaches cleanly and can be re-hosted the next time.
    /// </summary>
    public partial class DispatchDialog : Window
    {
        public DispatchDialog(Controls.DispatchPanel panel)
        {
            InitializeComponent();
            ContentHost.Content = panel;
            Closed += (_, _) => ContentHost.Content = null;
        }

        private void Window_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape)
            {
                e.Handled = true;
                Close();
            }
        }

        // ── Custom title bar (same pattern as ManifestViewerWindow/TestHistoryWindow, Git #1006) ──
        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();
    }
}

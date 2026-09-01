using System;
using System.Windows;

namespace BuildConsole
{
    public partial class NeedsAttentionDetailDialog : Window
    {
        public bool DismissRequested { get; private set; }
        private readonly Action? _onOpen;

        public NeedsAttentionDetailDialog(string title, string summary, string details, bool isFailure, DateTime atLocal, Action? onOpen)
        {
            InitializeComponent();
            _onOpen = onOpen;

            IconText.Text = isFailure ? "🔴" : "📷";
            HeadingText.Text = title;
            TimeText.Text = $"Recorded on {atLocal:MMM d, yyyy · h:mm:ss tt}";
            SummaryText.Text = summary;

            string displayDetails = string.IsNullOrWhiteSpace(details) ? summary : details;
            DetailsBox.Text = displayDetails;

            if (onOpen == null)
            {
                OpenBtn.Visibility = Visibility.Collapsed;
            }
        }

        private void CopyBtn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                Clipboard.SetText(DetailsBox.Text);
                CopyBtn.Content = "✓ Copied!";
            }
            catch
            {
                CopyBtn.Content = "Copy failed";
            }
        }

        private void OpenBtn_Click(object sender, RoutedEventArgs e)
        {
            try
            {
                _onOpen?.Invoke();
            }
            catch (Exception ex)
            {
                AppDialog.Alert(this, $"Failed to open: {ex.Message}", "Error", AppDialogIcon.Warning);
            }
        }

        private void DismissBtn_Click(object sender, RoutedEventArgs e)
        {
            DismissRequested = true;
            Close();
        }

        private void CloseBtn_Click(object sender, RoutedEventArgs e)
        {
            DismissRequested = false;
            Close();
        }
    }
}

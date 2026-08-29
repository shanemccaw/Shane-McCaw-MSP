using System;
using System.Windows;

namespace BuildConsole
{
    /// <summary>Real, immediate need: Shane has real chats he can't currently
    /// associate to Epics through any manual path. Right-click an epic in the
    /// Git Board -> "Assign Chat to Epic..." opens this. Two ways to supply the
    /// chat: paste its URL directly, or press "Assign current chat" to pull the
    /// URL off whatever chat tab is actually focused right now (via the
    /// <see cref="_getActiveChatUrl"/> callback LeftSidebar wires to MainWindow's
    /// EditorTabs.SelectedItem) so Shane doesn't have to copy/paste when the chat
    /// he wants is already open. The actual conversation-id extraction + real
    /// POST /chats/ingest write happens back in LeftSidebar's context menu
    /// handler (same BuildTrackerApiClient.LinkChatToEpicAsync every other
    /// chat-epic assignment already goes through) — this dialog only collects
    /// the URL.</summary>
    public partial class AssignChatToEpicDialog : Window
    {
        private readonly Func<string?>? _getActiveChatUrl;

        public string? ResultChatUrl { get; private set; }

        public AssignChatToEpicDialog(string epicLabel, string? prefillUrl, Func<string?>? getActiveChatUrl)
        {
            InitializeComponent();
            _getActiveChatUrl = getActiveChatUrl;
            TitleText.Text = $"Assign chat to {epicLabel}:";
            if (!string.IsNullOrWhiteSpace(prefillUrl)) ChatUrlBox.Text = prefillUrl;
        }

        private void UseCurrentChat_Click(object sender, RoutedEventArgs e)
        {
            var url = _getActiveChatUrl?.Invoke();
            if (string.IsNullOrWhiteSpace(url))
            {
                // Git #1629 (root cause 1) — the resolver now reads ANY selected tab's
                // live WebView2 URL (not just BuildConsole-opened chat tabs), so a null
                // here genuinely means "no conversation id exists to grab" — say why
                // plainly instead of a bare "no chat tab" that reads as a bug.
                StatusText.Text = "No selected tab is showing a claude.ai conversation — a brand-new chat has no conversation id until its first message is sent. Paste the chat URL instead.";
                StatusText.Visibility = Visibility.Visible;
                return;
            }
            ChatUrlBox.Text = url;
            StatusText.Visibility = Visibility.Collapsed;
        }

        private void Assign_Click(object sender, RoutedEventArgs e)
        {
            var url = ChatUrlBox.Text?.Trim() ?? "";
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out _))
            {
                StatusText.Text = "Enter a valid chat URL first.";
                StatusText.Visibility = Visibility.Visible;
                return;
            }
            ResultChatUrl = url;
            DialogResult = true;
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
        }
    }
}

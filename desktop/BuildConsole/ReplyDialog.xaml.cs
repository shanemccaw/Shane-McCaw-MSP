using System.Windows;

namespace BuildConsole
{
    /// <summary>
    /// Git #826 — Shane: "how do I respond when Code has a question... I
    /// need to be able to answer." A minimal reply prompt; the actual
    /// "continue the exact conversation" work happens server/watcher-side
    /// via --resume &lt;sessionId&gt; (see BuildQueuePanel's Reply handler) -
    /// this dialog just collects the reply text.
    /// </summary>
    public partial class ReplyDialog : Window
    {
        public string ReplyText => ReplyBox.Text.Trim();

        public ReplyDialog(string originalTitle)
        {
            InitializeComponent();
            TitleText.Text = $"Reply to: {originalTitle}";
            ReplyBox.Focus();
        }

        private void Send_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = true;
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
        }
    }
}

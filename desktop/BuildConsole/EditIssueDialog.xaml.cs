using System.Windows;

namespace BuildConsole
{
    /// <summary>Git #843 (Git Board Phase 5) — pre-filled with the issue's real current title/body; Save just returns the edited values, the actual `PATCH /issues/{n}` call happens in LeftSidebar's context menu handler via GitHubApiClient.</summary>
    public partial class EditIssueDialog : Window
    {
        public string ResultTitle { get; private set; } = string.Empty;
        public string ResultBody { get; private set; } = string.Empty;

        public EditIssueDialog(int issueNumber, string title, string body)
        {
            InitializeComponent();
            HeaderText.Text = $"Edit issue #{issueNumber}";
            TitleBox.Text = title;
            BodyBox.Text = body;
        }

        private void Save_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(TitleBox.Text))
            {
                AppDialog.Alert(this, "Title can't be empty.", "Edit Issue");
                return;
            }

            ResultTitle = TitleBox.Text.Trim();
            ResultBody = BodyBox.Text;
            DialogResult = true;
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
        }
    }
}

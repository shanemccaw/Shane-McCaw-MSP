using System.Collections.Generic;
using System.Windows;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #842 (Git Board Phase 4) — the Git Board's "+" button ("New Issue"
    /// tooltip when the current view is Issues) opens this: title, body, and
    /// an optional "assign to epic" via the real GitHub sub_issues API. Reuses
    /// #844's <see cref="AssignIssueEpicDialog"/> (real open epic issues, with
    /// search) rather than a second near-duplicate picker — same reusable
    /// component the task asked for, already landed for "Assign to Epic..."
    /// on an existing issue. The actual GitHub calls happen back in
    /// LeftSidebar's CreateNewIssueAsync — this dialog only collects input,
    /// same division of responsibility as ReplyDialog.
    /// </summary>
    public partial class NewIssueDialog : Window
    {
        private readonly List<GitBoardIssue> _epics;

        public string IssueTitle => TitleBox.Text.Trim();
        public string IssueBody => BodyBox.Text.Trim();
        public int? SelectedEpicNumber { get; private set; }

        public NewIssueDialog(List<GitBoardIssue> epics, string prefillTitle = "")
        {
            InitializeComponent();
            _epics = epics;
            TitleBox.Text = prefillTitle;
            TitleBox.Focus();
            if (!string.IsNullOrEmpty(prefillTitle))
            {
                TitleBox.CaretIndex = prefillTitle.Length;
            }
        }

        private void BtnPickEpic_Click(object sender, RoutedEventArgs e)
        {
            var titleForPrompt = string.IsNullOrWhiteSpace(TitleBox.Text) ? "this new issue" : TitleBox.Text.Trim();
            var dialog = new AssignIssueEpicDialog(titleForPrompt, _epics) { Owner = this };
            if (dialog.ShowDialog() != true || dialog.SelectedEpic == null) return;

            SelectedEpicNumber = dialog.SelectedEpic.Number;
            SelectedEpicText.Text = $"#{dialog.SelectedEpic.Number} {dialog.SelectedEpic.Title}";
            BtnClearEpic.Visibility = Visibility.Visible;
        }

        private void BtnClearEpic_Click(object sender, RoutedEventArgs e)
        {
            SelectedEpicNumber = null;
            SelectedEpicText.Text = "(none)";
            BtnClearEpic.Visibility = Visibility.Collapsed;
        }

        private void Create_Click(object sender, RoutedEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(TitleBox.Text))
            {
                MessageBox.Show("Title is required.", "New Issue");
                return;
            }
            DialogResult = true;
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
        }
    }
}

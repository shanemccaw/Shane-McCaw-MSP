using System.Collections.Generic;
using System.Linq;
using System.Windows;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>Git #844 (Git Board Phase 6) — Shane: "Assign to Epic..." on a plain Git Board issue. Search/select from the real open issues that ARE epics (already fetched by #839's ListBoardIssuesAsync, no second GitHub call); the real assignment call happens in LeftSidebar's context menu handler via GitHubApiClient.AddSubIssueAsync.</summary>
    public partial class AssignIssueEpicDialog : Window
    {
        private class EpicPickerItem
        {
            public GitBoardIssue Issue { get; }
            public string Label => $"#{Issue.Number}  {Issue.Title}  ({Issue.SubIssueCount} sub)";
            public EpicPickerItem(GitBoardIssue issue) => Issue = issue;
        }

        private readonly List<EpicPickerItem> _allEpics;

        public GitBoardIssue? SelectedEpic { get; private set; }

        public AssignIssueEpicDialog(string issueTitle, List<GitBoardIssue> epics)
        {
            InitializeComponent();
            TitleText.Text = $"Assign \"{issueTitle}\" to epic:";
            _allEpics = epics.Select(e => new EpicPickerItem(e)).ToList();
            EpicList.ItemsSource = _allEpics;
        }

        private void SearchBox_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
        {
            var query = SearchBox.Text.Trim();
            EpicList.ItemsSource = string.IsNullOrEmpty(query)
                ? _allEpics
                : _allEpics.Where(i =>
                    i.Issue.Title.Contains(query, System.StringComparison.OrdinalIgnoreCase) ||
                    i.Issue.Number.ToString().Contains(query)).ToList();
        }

        private void Assign_Click(object sender, RoutedEventArgs e)
        {
            if (EpicList.SelectedItem is EpicPickerItem item)
            {
                SelectedEpic = item.Issue;
                DialogResult = true;
            }
        }

        private void EpicList_MouseDoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (EpicList.SelectedItem is EpicPickerItem item)
            {
                SelectedEpic = item.Issue;
                DialogResult = true;
            }
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
        }
    }
}

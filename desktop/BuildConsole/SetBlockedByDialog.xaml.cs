using System.Collections.Generic;
using System.Linq;
using System.Windows;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>Git #845 (Git Board Phase 7) — Shane: "Set Blocked By..." on a Git Board issue. Search/select from the real open issues already fetched by #839's ListBoardIssuesAsync (no second GitHub call); the real dependency call happens in LeftSidebar's context menu handler via GitHubApiClient.SetBlockedByAsync.</summary>
    public partial class SetBlockedByDialog : Window
    {
        private class BlockerPickerItem
        {
            public GitBoardIssue Issue { get; }
            public string Label => $"#{Issue.Number}  {Issue.Title}";
            public BlockerPickerItem(GitBoardIssue issue) => Issue = issue;
        }

        private readonly List<BlockerPickerItem> _allCandidates;

        public GitBoardIssue? SelectedBlocker { get; private set; }

        public SetBlockedByDialog(string issueTitle, List<GitBoardIssue> candidates)
        {
            InitializeComponent();
            TitleText.Text = $"Set \"{issueTitle}\" blocked by:";
            _allCandidates = candidates.Select(c => new BlockerPickerItem(c)).ToList();
            BlockerList.ItemsSource = _allCandidates;
        }

        private void SearchBox_TextChanged(object sender, System.Windows.Controls.TextChangedEventArgs e)
        {
            var query = SearchBox.Text.Trim();
            BlockerList.ItemsSource = string.IsNullOrEmpty(query)
                ? _allCandidates
                : _allCandidates.Where(i =>
                    i.Issue.Title.Contains(query, System.StringComparison.OrdinalIgnoreCase) ||
                    i.Issue.Number.ToString().Contains(query)).ToList();
        }

        private void Set_Click(object sender, RoutedEventArgs e)
        {
            if (BlockerList.SelectedItem is BlockerPickerItem item)
            {
                SelectedBlocker = item.Issue;
                DialogResult = true;
            }
        }

        private void BlockerList_MouseDoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            if (BlockerList.SelectedItem is BlockerPickerItem item)
            {
                SelectedBlocker = item.Issue;
                DialogResult = true;
            }
        }

        private void Cancel_Click(object sender, RoutedEventArgs e)
        {
            DialogResult = false;
        }
    }
}

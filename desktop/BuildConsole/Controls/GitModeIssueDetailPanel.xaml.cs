using System;
using System.Windows.Controls;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #4247 — Git Mode's right-hand issue-detail panel. It occupies the Queue column's cell
    /// (Grid.Column 5) while Git Mode is active, replacing <c>BuildQueuePanel</c> exactly the way
    /// <see cref="TestModeComposerPanel"/> does in Test Mode.
    ///
    /// It is a thin host over the REAL <see cref="IssueDetailView"/> (the same control the #921 Git
    /// detail tabs use, GitHub-backed via GitHubApiClient with its own <c>_requestId</c> reentrancy
    /// guard) — not the from-scratch inspector the old GitModeContainer rebuilt.
    /// </summary>
    public partial class GitModeIssueDetailPanel : UserControl
    {
        /// <summary>Raised by the header's Exit button so MainWindow can leave Git Mode.</summary>
        public event Action? ExitGitModeRequested;

        public GitModeIssueDetailPanel()
        {
            InitializeComponent();
        }

        /// <summary>Load an issue's real detail (description + comment thread) into the panel,
        /// forwarding straight to the underlying <see cref="IssueDetailView"/>.</summary>
        public void LoadIssue(int issueNumber) => IssueDetail.LoadIssue(issueNumber);

        private void BtnExitGitMode_Click(object sender, System.Windows.RoutedEventArgs e)
            => ExitGitModeRequested?.Invoke();
    }
}

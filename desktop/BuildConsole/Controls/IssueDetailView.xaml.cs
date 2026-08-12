using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #840 (Git Board Phase 2) — Shane: "I need to be able to... read
    /// their descriptions, comments, etc..." Clicking an issue in the Git
    /// Board tree (LeftSidebar.IssueSelected) loads its real description and
    /// comment thread here, via GitHubApiClient.GetIssueAsync/GetIssueCommentsAsync
    /// (GET /issues/{n} + GET /issues/{n}/comments) — same docked-tab
    /// convention as BuildLogView/TestResultsView, not a floating window.
    /// </summary>
    public partial class IssueDetailView : UserControl
    {
        private const string Channel = "git-board.issue-detail";
        private int _requestId;

        public IssueDetailView()
        {
            InitializeComponent();
        }

        public async void LoadIssue(int number)
        {
            int myRequest = ++_requestId;

            EmptyState.Visibility = Visibility.Collapsed;
            NumberBadgeText.Text = $"#{number}";
            TitleLabel.Text = "Loading…";
            StateBadgeText.Text = "";
            BodyLabel.Visibility = Visibility.Collapsed;
            CommentsLabel.Visibility = Visibility.Collapsed;
            BodyText.Text = "";
            CommentsList.Items.Clear();
            LoadingText.Text = $"Loading #{number}…";
            LoadingText.Visibility = Visibility.Visible;

            var settings = BuildConsoleSettings.Load();
            if (!settings.HasGitHubPat)
            {
                LoadingText.Text = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings).";
                ActivityLog.Log(Channel, $"#{number}: no GitHub PAT configured");
                return;
            }

            try
            {
                var client = new GitHubApiClient(settings.GitHubPat);
                var issue = await client.GetIssueAsync(number);
                var comments = await client.GetIssueCommentsAsync(number);
                if (myRequest != _requestId) return; // superseded by a newer click

                if (issue == null)
                {
                    LoadingText.Text = $"Couldn't load #{number}: issue not found.";
                    ActivityLog.Log(Channel, $"#{number}: not found");
                    return;
                }

                TitleLabel.Text = issue.Title;
                StateBadgeText.Text = issue.State.ToUpperInvariant();
                StateBadgeText.Foreground = string.Equals(issue.State, "closed", StringComparison.OrdinalIgnoreCase)
                    ? GetBrush("RedBrush") : GetBrush("GreenBrush");

                BodyText.Text = string.IsNullOrWhiteSpace(issue.Body) ? "(no description)" : issue.Body;
                BodyLabel.Visibility = Visibility.Visible;

                CommentsLabel.Text = $"COMMENTS ({comments.Count})";
                CommentsLabel.Visibility = Visibility.Visible;
                foreach (var comment in comments) // GitHub returns these in chronological order already
                {
                    CommentsList.Items.Add(CreateCommentCard(comment));
                }

                LoadingText.Visibility = Visibility.Collapsed;
                ActivityLog.Log(Channel, $"#{number}: loaded ({comments.Count} comment(s))");
            }
            catch (Exception ex)
            {
                if (myRequest != _requestId) return;
                LoadingText.Text = $"Couldn't load #{number}: {ex.Message}";
                ActivityLog.Log(Channel, $"#{number}: load FAILED: {ex.Message}");
            }
        }

        private UIElement CreateCommentCard(GitHubIssueComment comment)
        {
            var border = new Border
            {
                Background = GetBrush("MantleBrush"),
                BorderBrush = GetBrush("Surface0Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(8),
                Margin = new Thickness(0, 0, 0, 8),
            };

            var panel = new StackPanel();

            var headerPanel = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            headerPanel.Children.Add(new TextBlock
            {
                Text = comment.User?.Login ?? "(unknown)",
                FontSize = 11,
                FontWeight = FontWeights.SemiBold,
                Foreground = GetBrush("BlueBrush"),
            });
            headerPanel.Children.Add(new TextBlock
            {
                Text = "  " + comment.CreatedAt.LocalDateTime.ToString("yyyy-MM-dd HH:mm"),
                FontSize = 10,
                Foreground = GetBrush("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center,
            });

            var bodyBlock = new TextBlock
            {
                Text = comment.Body,
                FontSize = 12,
                Foreground = GetBrush("TextBrush"),
                TextWrapping = TextWrapping.Wrap,
            };

            panel.Children.Add(headerPanel);
            panel.Children.Add(bodyBlock);
            border.Child = panel;
            return border;
        }

        private Brush GetBrush(string key)
        {
            try
            {
                if (TryFindResource(key) is Brush b) return b;
                if (Application.Current != null && Application.Current.TryFindResource(key) is Brush appB) return appB;
            }
            catch { }
            return Brushes.Gray;
        }
    }
}

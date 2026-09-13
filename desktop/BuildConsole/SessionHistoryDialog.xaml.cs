using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Phase 8: Dialog displaying testing session history, duration metrics,
    /// bug counts, clean confirmations, and Markdown audit log export.
    /// </summary>
    public partial class SessionHistoryDialog : Window
    {
        private List<VisualTestTrackerSession> _sessions = new();

        public SessionHistoryDialog()
        {
            InitializeComponent();
            LoadSessionHistory();
        }

        private void LoadSessionHistory()
        {
            _sessions = VisualTestTrackerSessionStore.GetHistory();
            RenderMetrics();
            RenderCards();
        }

        private void RenderMetrics()
        {
            MetricTotalSessions.Text = _sessions.Count.ToString();

            double totalSeconds = _sessions.Sum(s => s.TotalElapsed.TotalSeconds);
            var totalTime = TimeSpan.FromSeconds(totalSeconds);
            if (totalTime.TotalHours >= 1)
                MetricTotalTime.Text = $"{(int)totalTime.TotalHours}h {totalTime.Minutes}m";
            else
                MetricTotalTime.Text = $"{totalTime.Minutes}m {totalTime.Seconds:D2}s";

            int totalBugs = _sessions.Sum(s => s.BugsLoggedCount);
            MetricTotalBugs.Text = totalBugs.ToString();

            int cleanCount = _sessions.Count(s => s.IsCleanConfirmed);
            MetricTotalClean.Text = cleanCount.ToString();
        }

        private void RenderCards()
        {
            SessionCardsPanel.Children.Clear();
            if (_sessions.Count == 0)
            {
                EmptyHistoryText.Visibility = Visibility.Visible;
                return;
            }
            EmptyHistoryText.Visibility = Visibility.Collapsed;

            foreach (var session in _sessions)
            {
                SessionCardsPanel.Children.Add(BuildSessionCard(session));
            }
        }

        private UIElement BuildSessionCard(VisualTestTrackerSession session)
        {
            var card = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = (Brush)FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(10, 8, 10, 8),
                Margin = new Thickness(0, 0, 0, 6)
            };

            var grid = new Grid();
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            // Row 0: Route + Base URL & Status Badge
            var topRow = new Grid();
            topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var routePanel = new StackPanel { Orientation = Orientation.Horizontal };
            var routeText = new TextBlock
            {
                Text = session.DisplayRoute,
                FontSize = 11,
                FontFamily = new FontFamily("Consolas"),
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center
            };
            var baseText = new TextBlock
            {
                Text = $"  ({session.BaseUrl})",
                FontSize = 10,
                Foreground = (Brush)FindResource("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center
            };
            routePanel.Children.Add(routeText);
            routePanel.Children.Add(baseText);
            Grid.SetColumn(routePanel, 0);

            // Status Badge
            var badgeBorder = new Border
            {
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(6, 2, 6, 2),
                VerticalAlignment = VerticalAlignment.Center
            };
            var badgeText = new TextBlock { FontSize = 9, FontWeight = FontWeights.SemiBold };

            if (session.IsCleanConfirmed)
            {
                badgeBorder.Background = (Brush)FindResource("Surface1Brush");
                badgeText.Foreground = (Brush)FindResource("StatusSuccessBrush");
                badgeText.Text = "✅ Confirmed Clean";
            }
            else if (session.BugsLoggedCount > 0)
            {
                badgeBorder.Background = (Brush)FindResource("Surface1Brush");
                badgeText.Foreground = (Brush)FindResource("StatusWarningBrush");
                badgeText.Text = $"🐞 {session.BugsLoggedCount} bugs logged";
            }
            else if (session.IsActive)
            {
                badgeBorder.Background = (Brush)FindResource("Surface1Brush");
                badgeText.Foreground = (Brush)FindResource("AccentBrush");
                badgeText.Text = "🔍 Active Session";
            }
            else
            {
                badgeBorder.Background = (Brush)FindResource("Surface1Brush");
                badgeText.Foreground = (Brush)FindResource("Subtext1Brush");
                badgeText.Text = "Tested";
            }
            badgeBorder.Child = badgeText;
            Grid.SetColumn(badgeBorder, 1);

            topRow.Children.Add(routePanel);
            topRow.Children.Add(badgeBorder);
            Grid.SetRow(topRow, 0);

            // Row 1: Sub metrics (Duration, Started at, Telemetry count)
            var subRow = new Grid { Margin = new Thickness(0, 4, 0, 0) };
            subRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            subRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            subRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var timeText = new TextBlock
            {
                Text = $"⏱ Duration: {session.FormattedDuration}",
                FontSize = 9,
                FontWeight = FontWeights.SemiBold,
                Foreground = (Brush)FindResource("AccentBrush"),
                Margin = new Thickness(0, 0, 12, 0)
            };
            Grid.SetColumn(timeText, 0);

            var startText = new TextBlock
            {
                Text = $"Started: {session.StartedAt:yyyy-MM-dd HH:mm:ss}",
                FontSize = 9,
                Foreground = (Brush)FindResource("Subtext1Brush"),
                Margin = new Thickness(0, 0, 12, 0)
            };
            Grid.SetColumn(startText, 1);

            var eventsText = new TextBlock
            {
                Text = $"👣 {session.TelemetryEventsCount} interactions",
                FontSize = 9,
                Foreground = (Brush)FindResource("Subtext1Brush")
            };
            Grid.SetColumn(eventsText, 2);

            subRow.Children.Add(timeText);
            subRow.Children.Add(startText);
            subRow.Children.Add(eventsText);
            Grid.SetRow(subRow, 1);

            grid.Children.Add(topRow);
            grid.Children.Add(subRow);
            card.Child = grid;

            return card;
        }

        private void BtnCopyMarkdown_Click(object sender, RoutedEventArgs e)
        {
            var md = VisualTestTrackerSessionStore.ToMarkdownAuditLog(_sessions);
            Clipboard.SetText(md);

            StatusMessage.Text = "✓ Copied session audit trail to clipboard as Markdown.";
            StatusMessage.Visibility = Visibility.Visible;
        }

        private void BtnClearHistory_Click(object sender, RoutedEventArgs e)
        {
            if (MessageBox.Show("Are you sure you want to clear all session history?",
                "Confirm Clear History", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
            {
                VisualTestTrackerSessionStore.ClearHistory();
                LoadSessionHistory();
                StatusMessage.Text = "✓ All session history cleared.";
                StatusMessage.Visibility = Visibility.Visible;
            }
        }

        private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            try { DragMove(); } catch { }
        }

        private void BtnClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }
    }
}

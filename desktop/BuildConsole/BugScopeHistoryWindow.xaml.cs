using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #3984 — reusable "clean bugs/issues/builds history view" for a scoped set of
    /// <see cref="VisualTestTrackerEntry"/> rows (element / page-level / global — the caller decides
    /// the scope by which query it ran; this window only renders whatever list it's given, newest
    /// first). Built for the combined per-tab toolbar icon (#3984) but deliberately not tied to that
    /// scope's shape — #3983's element-level icon reuses this same window rather than a second one.
    /// </summary>
    public partial class BugScopeHistoryWindow : Window
    {
        public BugScopeHistoryWindow(string title, string scopeDescription, IReadOnlyList<VisualTestTrackerEntry> entries)
        {
            InitializeComponent();
            TxtWindowTitle.Text = title;
            TxtScopeDescription.Text = scopeDescription;
            Render(entries);
        }

        private void Render(IReadOnlyList<VisualTestTrackerEntry> entries)
        {
            BugCardsPanel.Children.Clear();
            if (entries == null || entries.Count == 0)
            {
                TxtEmpty.Visibility = Visibility.Visible;
                return;
            }
            TxtEmpty.Visibility = Visibility.Collapsed;

            foreach (var entry in entries.OrderByDescending(e => e.CreatedAt))
            {
                BugCardsPanel.Children.Add(BuildCard(entry));
            }
        }

        private Border BuildCard(VisualTestTrackerEntry entry)
        {
            var (glyph, brush) = StatusVisual.For(entry.Status, entry.Resolution);

            var card = new Border
            {
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = (Brush)FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10, 8, 10, 8),
                Margin = new Thickness(0, 0, 0, 8)
            };

            var stack = new StackPanel();

            // Top row: status dot + bug number/title + status label
            var topRow = new DockPanel();
            var leftStack = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            leftStack.Children.Add(new TextBlock
            {
                Text = glyph,
                FontWeight = FontWeights.Bold,
                Foreground = brush,
                FontSize = 13,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            });
            string title = !string.IsNullOrWhiteSpace(entry.Title) ? entry.Title : "(untitled)";
            leftStack.Children.Add(new TextBlock
            {
                Text = entry.BugNumber > 0 ? $"[BUG-{entry.BugNumber}] {title}" : title,
                FontWeight = FontWeights.SemiBold,
                FontSize = 12,
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxWidth = 300,
                Foreground = (Brush)FindResource("TextBrush"),
                VerticalAlignment = VerticalAlignment.Center
            });
            DockPanel.SetDock(leftStack, Dock.Left);
            topRow.Children.Add(leftStack);

            var statusBadge = new Border
            {
                Background = (Brush)FindResource("CrustBrush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(6, 1, 6, 1),
                HorizontalAlignment = HorizontalAlignment.Right
            };
            statusBadge.Child = new TextBlock
            {
                Text = entry.Status,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = brush
            };
            topRow.Children.Add(statusBadge);
            stack.Children.Add(topRow);

            if (entry.IsDesign)
            {
                stack.Children.Add(new TextBlock
                {
                    Text = "🎨 Design",
                    FontSize = 10,
                    Foreground = (Brush)FindResource("Subtext0Brush"),
                    Margin = new Thickness(0, 4, 0, 0)
                });
            }

            // Resolution line (only once closed)
            if (!string.IsNullOrWhiteSpace(entry.Resolution))
            {
                string resLabel = entry.Resolution == "NotABug" ? "Not a Bug" : entry.Resolution!;
                string reason = !string.IsNullOrWhiteSpace(entry.ResolutionReason) ? $" — {entry.ResolutionReason}" : "";
                stack.Children.Add(new TextBlock
                {
                    Text = $"Resolution: {resLabel}{reason}",
                    FontSize = 11,
                    Foreground = (Brush)FindResource("Subtext1Brush"),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 4, 0, 0)
                });
            }

            // Meta row: Git issue link, closing build, timestamps
            var metaPanel = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };

            if (entry.GitIssueNumber.HasValue)
            {
                var link = new TextBlock { Margin = new Thickness(0, 0, 10, 0), FontSize = 10 };
                var hyperlink = new Hyperlink(new Run($"#{entry.GitIssueNumber.Value}"))
                {
                    Foreground = (Brush)FindResource("BlueBrush")
                };
                hyperlink.Click += (s, e) =>
                {
                    try
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = $"https://github.com/shanemccaw/Shane-McCaw-MSP/issues/{entry.GitIssueNumber.Value}",
                            UseShellExecute = true
                        });
                    }
                    catch { }
                };
                link.Inlines.Add(new Run("GitHub "));
                link.Inlines.Add(hyperlink);
                metaPanel.Children.Add(link);
            }

            if (!string.IsNullOrWhiteSpace(entry.ClosingBuildId))
            {
                metaPanel.Children.Add(new TextBlock
                {
                    Text = $"Build: {entry.ClosingBuildId}",
                    FontSize = 10,
                    Foreground = (Brush)FindResource("Subtext0Brush"),
                    Margin = new Thickness(0, 0, 10, 0)
                });
            }

            metaPanel.Children.Add(new TextBlock
            {
                Text = $"Created: {entry.CreatedAt:yyyy-MM-dd HH:mm}",
                FontSize = 10,
                Foreground = (Brush)FindResource("OverlayBrush"),
                Margin = new Thickness(0, 0, 10, 0)
            });
            if (entry.UpdatedAt != entry.CreatedAt)
            {
                metaPanel.Children.Add(new TextBlock
                {
                    Text = $"Updated: {entry.UpdatedAt:yyyy-MM-dd HH:mm}",
                    FontSize = 10,
                    Foreground = (Brush)FindResource("OverlayBrush")
                });
            }

            stack.Children.Add(metaPanel);
            card.Child = stack;
            return card;
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

    /// <summary>Git #3984 — one shared status→(glyph, brush) mapping so the toolbar icon and the
    /// detail window color bugs identically. Four real, distinct states: Open, Verifying,
    /// Closed+Fixed, Closed+NotABug (a Closed row with no resolution yet — shouldn't happen once
    /// #3978's CHECK constraints are live, but falls back to the Fixed color rather than throwing).</summary>
    internal static class StatusVisual
    {
        public static (string Glyph, Brush Brush) For(string status, string? resolution)
        {
            if (string.Equals(status, "Verifying", StringComparison.OrdinalIgnoreCase))
                return ("●", (Brush)Application.Current.FindResource("SkyBrush"));

            if (string.Equals(status, "Closed", StringComparison.OrdinalIgnoreCase))
            {
                return string.Equals(resolution, "NotABug", StringComparison.OrdinalIgnoreCase)
                    ? ("●", (Brush)Application.Current.FindResource("OverlayBrush"))
                    : ("●", (Brush)Application.Current.FindResource("GreenBrush"));
            }

            // "Open" (or any unrecognized value — never silently render nothing)
            return ("●", (Brush)Application.Current.FindResource("YellowBrush"));
        }
    }
}

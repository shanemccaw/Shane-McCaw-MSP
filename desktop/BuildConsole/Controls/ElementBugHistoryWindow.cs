using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #3983 — the detail view opened by clicking the DOM inspector popover's bug-status icon.
    /// Lists every bug tracked against that exact element (same (page_id, selector) key the icon
    /// itself was colored from), newest first: bug number, status, resolution, linked GitHub issue
    /// (clickable), closing build id, created/updated timestamps. Code-only window, same lightweight
    /// pattern as <see cref="SimpleTextPromptDialog"/> — no separate XAML needed for a read-only list.
    /// </summary>
    internal static class ElementBugHistoryWindow
    {
        public static void Show(FrameworkElement owner, DomElementInfo element, List<VisualTestTrackerEntry> bugs)
        {
            var win = new Window
            {
                Title = $"Bug History — {element.Selector}",
                Width = 560,
                Height = 480,
                MinWidth = 420,
                MinHeight = 260,
                Owner = Window.GetWindow(owner),
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E))
            };

            var root = new DockPanel { Margin = new Thickness(14) };

            var header = new TextBlock
            {
                Text = $"{bugs.Count} bug{(bugs.Count == 1 ? "" : "s")} logged against `{element.Selector}`",
                FontWeight = FontWeights.Bold,
                FontSize = 13,
                Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10)
            };
            DockPanel.SetDock(header, Dock.Top);
            root.Children.Add(header);

            var closeBtn = new Button
            {
                Content = "Close",
                HorizontalAlignment = HorizontalAlignment.Right,
                Padding = new Thickness(14, 6, 14, 6),
                Margin = new Thickness(0, 10, 0, 0),
                IsCancel = true,
                IsDefault = true
            };
            closeBtn.Click += (_, _) => win.Close();
            DockPanel.SetDock(closeBtn, Dock.Bottom);
            root.Children.Add(closeBtn);

            var scroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            var list = new StackPanel();

            foreach (var bug in bugs.OrderByDescending(b => b.CreatedAt))
            {
                list.Children.Add(BuildBugRow(bug));
            }

            scroll.Content = list;
            root.Children.Add(scroll);

            win.Content = root;
            win.Show();
            win.Activate();
        }

        private static UIElement BuildBugRow(VisualTestTrackerEntry bug)
        {
            var (colorHex, label) = ElementBugStatusPresenter.ColorAndLabelFor(bug);
            var color = (Color)ColorConverter.ConvertFromString(colorHex);
            var colorBrush = new SolidColorBrush(color);

            var card = new Border
            {
                Background = new SolidColorBrush(Color.FromRgb(0x2A, 0x2B, 0x3D)),
                BorderBrush = colorBrush,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5),
                Padding = new Thickness(10, 8, 10, 8),
                Margin = new Thickness(0, 0, 0, 8)
            };

            var stack = new StackPanel();

            var topRow = new StackPanel { Orientation = Orientation.Horizontal };
            topRow.Children.Add(new TextBlock
            {
                Text = $"BUG-{(bug.BugNumber > 0 ? bug.BugNumber : bug.Id)}",
                FontWeight = FontWeights.Bold,
                FontFamily = new FontFamily("Consolas"),
                Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 10, 0)
            });

            var statusBadge = new Border
            {
                Background = colorBrush,
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(6, 1, 6, 1),
                VerticalAlignment = VerticalAlignment.Center
            };
            statusBadge.Child = new TextBlock
            {
                Text = label,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                Foreground = Brushes.White
            };
            topRow.Children.Add(statusBadge);

            if (bug.IsDesign)
            {
                topRow.Children.Add(new TextBlock
                {
                    Text = "🎨 Design",
                    FontSize = 10,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)),
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(8, 0, 0, 0)
                });
            }

            stack.Children.Add(topRow);

            string title = !string.IsNullOrWhiteSpace(bug.Title)
                ? bug.Title
                : (!string.IsNullOrWhiteSpace(bug.Notes)
                    ? bug.Notes.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? ""
                    : "");
            if (!string.IsNullOrWhiteSpace(title))
            {
                stack.Children.Add(new TextBlock
                {
                    Text = title,
                    TextWrapping = TextWrapping.Wrap,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xBA, 0xC2, 0xDE)),
                    Margin = new Thickness(0, 4, 0, 0)
                });
            }

            var metaRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };

            if (bug.GitIssueNumber.HasValue)
            {
                var link = new Hyperlink(new Run($"GitHub #{bug.GitIssueNumber.Value}"))
                {
                    NavigateUri = new Uri($"https://github.com/shanemccaw/Shane-McCaw-MSP/issues/{bug.GitIssueNumber.Value}")
                };
                link.RequestNavigate += (_, e) =>
                {
                    Process.Start(new ProcessStartInfo(e.Uri.AbsoluteUri) { UseShellExecute = true });
                    e.Handled = true;
                };
                metaRow.Children.Add(new TextBlock(link)
                {
                    Margin = new Thickness(0, 0, 12, 0),
                    Foreground = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8))
                });
            }

            if (!string.IsNullOrWhiteSpace(bug.ClosingBuildId))
            {
                metaRow.Children.Add(new TextBlock
                {
                    Text = $"Closing build: {bug.ClosingBuildId}",
                    FontSize = 10,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)),
                    Margin = new Thickness(0, 0, 12, 0)
                });
            }

            metaRow.Children.Add(new TextBlock
            {
                Text = $"Created {bug.CreatedAt:yyyy-MM-dd HH:mm} · Updated {bug.UpdatedAt:yyyy-MM-dd HH:mm}",
                FontSize = 10,
                Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8))
            });

            stack.Children.Add(metaRow);

            if (!string.IsNullOrWhiteSpace(bug.ResolutionReason))
            {
                stack.Children.Add(new TextBlock
                {
                    Text = $"{(bug.Resolution == "NotABug" ? "Not a Bug" : bug.Resolution)}: {bug.ResolutionReason}",
                    FontStyle = FontStyles.Italic,
                    FontSize = 10.5,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)),
                    TextWrapping = TextWrapping.Wrap,
                    Margin = new Thickness(0, 4, 0, 0)
                });
            }

            card.Child = stack;
            return card;
        }
    }
}

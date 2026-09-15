using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #4149 — the real per-Epic-group "label + copy Git #n list" header row, extracted from
    /// #4146's original AiBatterUpPanel-only <c>BuildEpicGroupHeader</c> so a second Epic-grouped
    /// panel (<see cref="WhatsRemainingPanel"/>) shares the exact same clipboard format instead of
    /// re-deriving it independently. AiBatterUpPanel's own <c>BuildEpicGroupHeader</c> now calls
    /// this too.
    /// </summary>
    internal static class EpicGroupHeaderHelper
    {
        /// <summary>Builds one Epic-group header: a bold group <paramref name="label"/> on the left,
        /// a real 📋 copy button on the right that copies <paramref name="copyHeaderLine"/> followed
        /// by one "Git #n" line per number in <paramref name="issueNumbers"/> (same format #4146
        /// established) to the clipboard.</summary>
        public static UIElement Build(string label, IReadOnlyList<int> issueNumbers, string copyHeaderLine)
        {
            var grid = new Grid { Margin = new Thickness(4, 10, 0, 4) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var labelBlock = new TextBlock
            {
                Text = label,
                FontSize = 11,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)Application.Current.FindResource("Subtext1Brush"),
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(labelBlock, 0);
            grid.Children.Add(labelBlock);

            // Git #4146 — same IconButton copy-button pattern SettingsTabView.xaml.cs's per-row
            // copy button uses (📋 content, IconButton style, Clipboard.SetText + ToastEngine).
            var copyBtn = new Button
            {
                Content = "📋",
                ToolTip = $"Copy \"Git #\" list for {label}",
                Style = (Style)Application.Current.FindResource("IconButton"),
                Padding = new Thickness(5, 1, 5, 1),
                FontSize = 9.5,
                VerticalAlignment = VerticalAlignment.Center,
            };
            copyBtn.Click += (_, _) =>
            {
                var lines = new List<string> { copyHeaderLine };
                lines.AddRange(issueNumbers.Select(n => $"Git #{n}"));
                try
                {
                    Clipboard.SetText(string.Join(Environment.NewLine, lines));
                    ToastEngine.Success("Copied", $"Copied {issueNumbers.Count} issue number(s) for {label}.");
                }
                catch (Exception ex)
                {
                    ToastEngine.Error("Copy", $"Couldn't copy: {ex.Message}");
                }
            };
            Grid.SetColumn(copyBtn, 1);
            grid.Children.Add(copyBtn);

            return grid;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Controls;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #3658 — "Tab" action for the Build Matrix drawer (<see cref="BuildQueuePanel"/>'s own
    /// BtnMatrixSendToTab_Click). Real salvage of ShaneBuilder's own
    /// desktop/ShaneBuilder/MainWindow.BuildMatrixPanel.cs, re-implemented against BuildConsole's
    /// real tab-opening convention (same open-or-focus + header/close/drag recipe
    /// MainWindow.SettingsTab.cs / MainWindow.BatterUpTabs.cs already use) rather than
    /// copy-pasted. Unlike Batter Up/Settings, this tab's content is a plain FROZEN snapshot,
    /// not a persistent live view — a slot that finished after this tab was sent stays showing
    /// what it was sent, honestly, not silently live. Re-sending replaces the existing tab's
    /// content rather than opening a duplicate, since slots may have moved since it was last sent.
    /// </summary>
    public partial class MainWindow
    {
        private const string BuildMatrixTabChannel = "build-matrix.tab";
        private const string BuildMatrixTabKey = "build-matrix:main";

        /// <summary>One frozen slot, as sent by BuildQueuePanel.BuildMatrixSnapshotNow().</summary>
        public readonly record struct BuildMatrixSlotSnapshot(
            int Number, bool Busy, int? GithubNumber, string? Title, string? BuildSet, string? Model, string? Status);

        /// <summary>Opens (or refreshes + focuses) the single Build Matrix document tab with a
        /// frozen snapshot of the current slots.</summary>
        public void OpenBuildMatrixTab(
            IReadOnlyList<(int Number, bool Busy, int? GithubNumber, string? Title, string? BuildSet, string? Model, string? Status)> slots,
            int busyCount, int slotCount)
        {
            var snapshot = slots.Select(s => new BuildMatrixSlotSnapshot(s.Number, s.Busy, s.GithubNumber, s.Title, s.BuildSet, s.Model, s.Status)).ToList();

            // Refresh — remove any existing tab first (slots may have moved since it was last sent).
            TabItem? existing = null;
            foreach (TabItem item in EditorTabs.Items)
            {
                if (item.Tag is string tag && string.Equals(tag, BuildMatrixTabKey, StringComparison.Ordinal))
                {
                    existing = item;
                    break;
                }
            }
            if (existing != null) EditorTabs.Items.Remove(existing);

            AddBuildMatrixTab(snapshot, busyCount, slotCount);
            ActivityLog.Log(BuildMatrixTabChannel, $"tab opened — {busyCount}/{slotCount} slots at send time");
        }

        private void AddBuildMatrixTab(IReadOnlyList<BuildMatrixSlotSnapshot> snapshot, int busyCount, int slotCount)
        {
            var headerPanel = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            headerPanel.Children.Add(new TextBlock { Text = "▦", FontSize = 12, Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center });
            headerPanel.Children.Add(new TextBlock
            {
                Text = "Build Matrix",
                FontSize = 13,
                Margin = new Thickness(0, 0, 8, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush"),
                MaxWidth = 260,
                TextTrimming = TextTrimming.CharacterEllipsis,
                ToolTip = "Build Matrix"
            });
            var closeBtn = new Button
            {
                Content = "✕",
                Style = (Style)FindResource("IconButton"),
                FontSize = 10,
                Padding = new Thickness(3, 1, 3, 1),
                Margin = new Thickness(4, 0, 0, 0),
                ToolTip = "Close Tab",
                VerticalAlignment = VerticalAlignment.Center
            };
            headerPanel.Children.Add(closeBtn);

            var newTab = new TabItem
            {
                Tag = BuildMatrixTabKey,
                Header = headerPanel,
                Content = BuildBuildMatrixDocContent(snapshot, busyCount, slotCount)
            };

            AttachTabContextMenu(newTab, EditorTabs);
            AttachTabDragHandlers(newTab);
            closeBtn.Click += (s, e) => CloseTab(newTab, EditorTabs);

            EditorTabs.Items.Add(newTab);
            EditorTabs.SelectedItem = newTab;
        }

        /// <summary>Renders the frozen document — the same 8 slot cards the live drawer shows, off
        /// the frozen snapshot rather than live queue state. Inert: no click handler, no pulse —
        /// same "clickable on the live surface, inert on the sent copy" convention the live drawer's
        /// own <see cref="BuildQueuePanel"/> click-to-focus doesn't carry over here.</summary>
        private static ScrollViewer BuildBuildMatrixDocContent(IReadOnlyList<BuildMatrixSlotSnapshot> snapshot, int busyCount, int slotCount)
        {
            var host = new StackPanel { Margin = new Thickness(12) };
            host.Children.Add(new TextBlock
            {
                Text = $"{busyCount}/{slotCount} slots, at send time.",
                Margin = new Thickness(0, 0, 0, 10),
                TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)Application.Current.FindResource("Subtext0Brush"),
                FontSize = 11
            });

            var grid = new WrapPanel();
            foreach (var s in snapshot)
                grid.Children.Add(BuildMatrixDocSlotCard(s));
            host.Children.Add(grid);

            return new ScrollViewer { Content = host, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        }

        private static Border BuildMatrixDocSlotCard(BuildMatrixSlotSnapshot s)
        {
            Color accent = s.Busy && s.Status != null ? MatrixDocStatusColor(s.Status) : Color.FromRgb(0x6C, 0x70, 0x86);

            var card = new Border
            {
                Width = 150,
                Margin = new Thickness(0, 0, 6, 6),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Background = s.Busy ? new SolidColorBrush(Color.FromArgb(0x1a, accent.R, accent.G, accent.B)) : (Brush)Application.Current.FindResource("Surface0Brush"),
                BorderBrush = s.Busy ? new SolidColorBrush(Color.FromArgb(0x66, accent.R, accent.G, accent.B)) : (Brush)Application.Current.FindResource("Surface1Brush"),
                BorderThickness = new Thickness(1),
                Opacity = s.Busy ? 1.0 : 0.45
            };

            var stack = new StackPanel();
            stack.Children.Add(new TextBlock
            {
                Text = $"SLOT {s.Number}",
                FontFamily = new FontFamily("Consolas"),
                FontSize = 9,
                FontWeight = FontWeights.Bold,
                Foreground = (Brush)Application.Current.FindResource("Subtext0Brush")
            });

            if (s.Busy)
            {
                stack.Children.Add(new Border
                {
                    Background = new SolidColorBrush(Color.FromArgb(0x33, accent.R, accent.G, accent.B)),
                    BorderBrush = new SolidColorBrush(accent),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(4),
                    Padding = new Thickness(6, 1.5, 6, 1.5),
                    Margin = new Thickness(0, 4, 0, 0),
                    HorizontalAlignment = HorizontalAlignment.Left,
                    Child = new TextBlock { Text = s.Status ?? "RUNNING", FontSize = 9.5, FontWeight = FontWeights.Bold, Foreground = new SolidColorBrush(accent) }
                });
                stack.Children.Add(new TextBlock
                {
                    Text = s.GithubNumber.HasValue ? $"#{s.GithubNumber.Value} {s.Title}" : s.Title,
                    Margin = new Thickness(0, 4, 0, 0),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    FontSize = 10.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = (Brush)Application.Current.FindResource("TextBrush")
                });
                string subtitle = string.Join(" · ", new[] { s.BuildSet, s.Model }.Where(v => !string.IsNullOrWhiteSpace(v)));
                if (!string.IsNullOrEmpty(subtitle))
                {
                    stack.Children.Add(new TextBlock
                    {
                        Text = subtitle,
                        Margin = new Thickness(0, 2, 0, 0),
                        TextTrimming = TextTrimming.CharacterEllipsis,
                        FontSize = 9,
                        Foreground = (Brush)Application.Current.FindResource("Subtext0Brush")
                    });
                }
            }
            else
            {
                stack.Children.Add(new TextBlock
                {
                    Text = "Idle",
                    Margin = new Thickness(0, 4, 0, 0),
                    FontSize = 10.5,
                    Foreground = (Brush)Application.Current.FindResource("Subtext0Brush")
                });
            }

            card.Child = stack;
            return card;
        }

        private static Color MatrixDocStatusColor(string status) => status switch
        {
            "NEEDS INPUT" => Color.FromRgb(0xF9, 0xE2, 0xAF),
            "PAUSED" => Color.FromRgb(0xFA, 0xB3, 0x87),
            _ => Color.FromRgb(0x89, 0xB4, 0xFA),
        };
    }
}

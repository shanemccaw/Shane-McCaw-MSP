using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git Mode Container (Phase 2).
    /// Manages the Left Panel Tree view powered strictly by Postgres data.
    /// Hierarchy: Milestone -> GATE issue / Epic -> Feature.
    /// Only open issues count toward progress.
    /// GATE nodes are visually distinct.
    /// </summary>
    public partial class GitModeContainer : UserControl
    {
        public event EventHandler<GitModeTreeNode>? NodeSelected;
        public event EventHandler? ExitGitModeRequested;
        public GitModeTreeNode? SelectedNode { get; private set; }

        private bool _loadedOnce;

        private void BtnExitGitMode_Click(object sender, RoutedEventArgs e)
        {
            ExitGitModeRequested?.Invoke(this, EventArgs.Empty);
        }

        public GitModeContainer()
        {
            InitializeComponent();
            Loaded += GitModeContainer_Loaded;
        }

        private async void GitModeContainer_Loaded(object sender, RoutedEventArgs e)
        {
            if (_loadedOnce) return;
            _loadedOnce = true;
            await RefreshTreeAsync();
        }

        public async Task RefreshTreeAsync()
        {
            TxtTreeStatus.Text = "Loading from Postgres...";
            TxtTreeCount.Text = "...";

            var nodes = await GitModeTreeService.LoadTreeFromPostgresAsync();

            EpicTree.Items.Clear();

            int totalOpenCount = 0;

            foreach (var msNode in nodes)
            {
                totalOpenCount += msNode.OpenCount;
                var msItem = CreateTreeNodeView(msNode);
                EpicTree.Items.Add(msItem);
            }

            TxtTreeCount.Text = $"{totalOpenCount} open";
            TxtTreeStatus.Text = $"Postgres • {nodes.Count} Milestones • {totalOpenCount} Open Issues";
        }

        private TreeViewItem CreateTreeNodeView(GitModeTreeNode node)
        {
            var item = new TreeViewItem
            {
                Tag = node,
                IsExpanded = node.Type == GitModeNodeType.Milestone || node.Type == GitModeNodeType.Epic
            };

            // Custom header content UI
            item.Header = BuildNodeHeaderContent(node);

            // Add children recursively
            foreach (var child in node.Children)
            {
                item.Items.Add(CreateTreeNodeView(child));
            }

            return item;
        }

        private FrameworkElement BuildNodeHeaderContent(GitModeTreeNode node)
        {
            // Container layout
            var border = new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(6, 4, 6, 4),
                Margin = new Thickness(0, 1, 0, 1)
            };

            var stack = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                VerticalAlignment = VerticalAlignment.Center
            };

            // Distinct visual styling for GATE nodes
            if (node.IsGate)
            {
                border.Background = (Brush)FindResource("Surface0Brush");
                border.BorderBrush = (Brush)FindResource("MauveBrush");
                border.BorderThickness = new Thickness(1);
            }
            else
            {
                border.Background = Brushes.Transparent;
            }

            // 1. Icon
            var iconText = new TextBlock
            {
                Text = node.IconGlyph,
                FontSize = node.Type == GitModeNodeType.Milestone ? 14 : 12,
                Margin = new Thickness(0, 0, 6, 0),
                VerticalAlignment = VerticalAlignment.Center
            };

            if (node.IsGate)
            {
                iconText.Foreground = (Brush)FindResource("MauveBrush");
            }
            else if (node.Type == GitModeNodeType.Milestone)
            {
                iconText.Foreground = (Brush)FindResource("PeachBrush");
            }
            else if (node.Type == GitModeNodeType.Epic)
            {
                iconText.Foreground = (Brush)FindResource("BlueBrush");
            }
            else
            {
                iconText.Foreground = (Brush)FindResource("Subtext0Brush");
            }

            stack.Children.Add(iconText);

            // 2. Title Text
            var titleText = new TextBlock
            {
                Text = node.Title,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxWidth = 220
            };

            if (node.IsGate)
            {
                titleText.FontWeight = FontWeights.Bold;
                titleText.Foreground = (Brush)FindResource("MauveBrush");
            }
            else if (node.Type == GitModeNodeType.Milestone)
            {
                titleText.FontWeight = FontWeights.SemiBold;
                titleText.Foreground = (Brush)FindResource("TextBrush");
            }
            else
            {
                titleText.Foreground = (Brush)FindResource("Subtext1Brush");
            }

            stack.Children.Add(titleText);

            // 3. Status/Open Badge
            var badgeBorder = new Border
            {
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1),
                Margin = new Thickness(8, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center
            };

            var badgeText = new TextBlock
            {
                Text = node.DisplayBadge,
                FontSize = 10,
                FontWeight = FontWeights.Medium
            };

            if (node.IsGate)
            {
                badgeBorder.Background = (Brush)FindResource("MauveBrush");
                badgeText.Foreground = (Brush)FindResource("BaseBrush");
                badgeText.FontWeight = FontWeights.Bold;
            }
            else if (node.IsOpen)
            {
                badgeBorder.Background = (Brush)FindResource("Surface0Brush");
                badgeText.Foreground = (Brush)FindResource("GreenBrush");
            }
            else
            {
                badgeBorder.Background = (Brush)FindResource("Surface0Brush");
                badgeText.Foreground = (Brush)FindResource("Overlay0Brush");
            }

            badgeBorder.Child = badgeText;
            stack.Children.Add(badgeBorder);

            border.Child = stack;
            return border;
        }

        private async void BtnRefreshTree_Click(object sender, RoutedEventArgs e)
        {
            await RefreshTreeAsync();
        }

        private void EpicTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is GitModeTreeNode node)
            {
                SelectedNode = node;
                TxtMiddleFilterState.Text = $"Graph Filter: [{node.Type}] #{node.Id} '{node.Title}'";
                NodeSelected?.Invoke(this, node);
            }
        }
    }
}

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git Mode Container (Phases 2 & 3).
    /// Left Panel: Milestone -> GATE -> Epic -> Feature Tree powered by Postgres.
    /// Middle Panel: Left-to-Right Interactive DAG Graph powered strictly by Postgres data.
    /// Supports Chain Mode toggling (Full Chain, Blockers Only, Dependents Only),
    /// visual node badges (Bucket, Build status, Dispatchable, GATE, Labels),
    /// and curved Bezier edge connectors.
    /// </summary>
    public partial class GitModeContainer : UserControl
    {
        public event EventHandler<GitModeTreeNode>? NodeSelected;
        public event EventHandler? ExitGitModeRequested;
        public GitModeTreeNode? SelectedNode { get; private set; }

        private bool _loadedOnce;
        private GitModeGraphData? _activeGraphData;
        private GitChainMode _activeChainMode = GitChainMode.FullChain;
        private int _selectedGraphIssue = 0;

        // Active Graph Filters
        private int? _milestoneFilter;
        private int? _epicFilter;
        private string? _bucketFilter;
        private string? _buildFilter;

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
            await RefreshAllAsync();
        }

        public async Task RefreshAllAsync()
        {
            await RefreshTreeAsync();
            await RefreshGraphAsync();
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

        public async Task RefreshGraphAsync()
        {
            TxtGraphFilterInfo.Text = "Loading...";

            _activeGraphData = await GitModeGraphService.LoadGraphFromPostgresAsync(
                _milestoneFilter,
                _epicFilter,
                _bucketFilter,
                _buildFilter,
                false);

            if (_selectedGraphIssue > 0)
            {
                GitModeGraphService.ApplyChainHighlighting(_activeGraphData, _selectedGraphIssue, _activeChainMode);
            }

            RenderGraph(_activeGraphData);
            UpdateGraphHeaderSummary();
        }

        private void UpdateGraphHeaderSummary()
        {
            if (_activeGraphData == null) return;

            string filterDesc = "All Issues";
            if (_milestoneFilter.HasValue && _milestoneFilter.Value > 0)
            {
                filterDesc = $"Milestone #{_milestoneFilter.Value}";
            }
            else if (_epicFilter.HasValue && _epicFilter.Value > 0)
            {
                filterDesc = $"Epic #{_epicFilter.Value}";
            }
            else if (!string.IsNullOrWhiteSpace(_bucketFilter) && !_bucketFilter.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                filterDesc = $"Bucket: {_bucketFilter}";
            }

            TxtGraphFilterInfo.Text = filterDesc;
            TxtGraphStatusSummary.Text = $"{_activeGraphData.Nodes.Count} Issues • {_activeGraphData.Edges.Count} Dependencies • Mode: {_activeChainMode}";
        }

        private void RenderGraph(GitModeGraphData data)
        {
            GraphCanvas.Children.Clear();
            if (data == null) return;

            GraphCanvas.Width = Math.Max(1200, data.TotalWidth);
            GraphCanvas.Height = Math.Max(800, data.TotalHeight);

            // 1. Render Grouping Containers
            foreach (var container in data.Containers)
            {
                var rect = new Rectangle
                {
                    Width = container.Bounds.Width,
                    Height = container.Bounds.Height,
                    Stroke = (Brush)FindResource("Surface1Brush"),
                    StrokeThickness = 1,
                    StrokeDashArray = new DoubleCollection { 4, 4 },
                    RadiusX = 8,
                    RadiusY = 8,
                    Fill = (Brush)FindResource("CrustBrush"),
                    Opacity = 0.3
                };
                Canvas.SetLeft(rect, container.Bounds.X);
                Canvas.SetTop(rect, container.Bounds.Y);
                GraphCanvas.Children.Add(rect);

                var title = new TextBlock
                {
                    Text = container.Header,
                    FontSize = 11,
                    FontWeight = FontWeights.Bold,
                    Foreground = (Brush)FindResource("Overlay0Brush")
                };
                Canvas.SetLeft(title, container.Bounds.X + 10);
                Canvas.SetTop(title, container.Bounds.Y + 8);
                GraphCanvas.Children.Add(title);
            }

            // 2. Render Curved Bezier Edges
            foreach (var edge in data.Edges)
            {
                Brush edgeBrush = GetEdgeBrush(edge.EdgeType);
                double opacity = edge.IsGhosted ? 0.2 : (edge.IsHighlighted ? 1.0 : 0.7);
                double thickness = edge.IsHighlighted ? 2.5 : 1.5;

                var pathFigure = new PathFigure { StartPoint = edge.StartPoint };
                var bezier = new BezierSegment(edge.ControlPoint1, edge.ControlPoint2, edge.EndPoint, true);
                pathFigure.Segments.Add(bezier);

                var pathGeo = new PathGeometry();
                pathGeo.Figures.Add(pathFigure);

                var path = new Path
                {
                    Data = pathGeo,
                    Stroke = edgeBrush,
                    StrokeThickness = thickness,
                    Opacity = opacity
                };

                GraphCanvas.Children.Add(path);

                // Render Arrowhead at EndPoint
                var arrow = CreateArrowhead(edge.ControlPoint2, edge.EndPoint, edgeBrush, opacity);
                GraphCanvas.Children.Add(arrow);
            }

            // 3. Render Node Cards
            foreach (var node in data.Nodes)
            {
                var card = CreateNodeCard(node);
                Canvas.SetLeft(card, node.X);
                Canvas.SetTop(card, node.Y);
                GraphCanvas.Children.Add(card);
            }
        }

        private Brush GetEdgeBrush(GitEdgeType type)
        {
            return type switch
            {
                GitEdgeType.HardBlock => (Brush)FindResource("RedBrush"),
                GitEdgeType.SoftBlock => (Brush)FindResource("YellowBrush"),
                GitEdgeType.Resolved => (Brush)FindResource("GreenBrush"),
                GitEdgeType.Build => (Brush)FindResource("BlueBrush"),
                GitEdgeType.Ai => (Brush)FindResource("MauveBrush"),
                _ => (Brush)FindResource("Overlay0Brush")
            };
        }

        private Polygon CreateArrowhead(Point fromPoint, Point toPoint, Brush brush, double opacity)
        {
            double angle = Math.Atan2(toPoint.Y - fromPoint.Y, toPoint.X - fromPoint.X);
            double arrowLength = 8;
            double arrowWidth = 5;

            Point p1 = toPoint;
            Point p2 = new Point(
                toPoint.X - arrowLength * Math.Cos(angle) + arrowWidth * Math.Sin(angle),
                toPoint.Y - arrowLength * Math.Sin(angle) - arrowWidth * Math.Cos(angle));
            Point p3 = new Point(
                toPoint.X - arrowLength * Math.Cos(angle) - arrowWidth * Math.Sin(angle),
                toPoint.Y - arrowLength * Math.Sin(angle) + arrowWidth * Math.Cos(angle));

            return new Polygon
            {
                Points = new PointCollection { p1, p2, p3 },
                Fill = brush,
                Opacity = opacity
            };
        }

        private UIElement CreateNodeCard(GitModeGraphNode node)
        {
            var cardBorder = new Border
            {
                Width = node.Width,
                Height = node.Height,
                CornerRadius = new CornerRadius(6),
                BorderThickness = new Thickness(node.IsSelected ? 2 : 1),
                Padding = new Thickness(0),
                Cursor = Cursors.Hand,
                Tag = node
            };

            // Background & Border colors
            if (node.IsSelected)
            {
                cardBorder.Background = (Brush)FindResource("Surface0Brush");
                cardBorder.BorderBrush = (Brush)FindResource("MauveBrush");
            }
            else if (node.IsHighlighted)
            {
                cardBorder.Background = (Brush)FindResource("Surface0Brush");
                cardBorder.BorderBrush = (Brush)FindResource("BlueBrush");
            }
            else
            {
                cardBorder.Background = (Brush)FindResource("MantleBrush");
                cardBorder.BorderBrush = (Brush)FindResource("Surface0Brush");
            }

            // Opacity for ghosted / completed blocker state
            if (node.IsGhosted)
            {
                cardBorder.Opacity = 0.25;
            }
            else if (node.IsCompletedBlocker)
            {
                cardBorder.Opacity = 0.5;
            }
            else
            {
                cardBorder.Opacity = 1.0;
            }

            // Main Grid Layout: Left Bucket Accent Bar + Right Content
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(5) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            // 1. Bucket Left Bar
            var bucketBar = new Border
            {
                Background = GetBucketBrush(node.Bucket),
                CornerRadius = new CornerRadius(3, 0, 0, 3)
            };
            Grid.SetColumn(bucketBar, 0);
            grid.Children.Add(bucketBar);

            // 2. Content Stack
            var contentStack = new StackPanel { Margin = new Thickness(8, 6, 8, 6) };
            Grid.SetColumn(contentStack, 1);

            // Top Header: Issue #, GATE / Dispatchable Badges
            var topHeader = new DockPanel { LastChildFill = false };

            var issueNumText = new TextBlock
            {
                Text = $"#{node.IssueNumber}",
                FontWeight = FontWeights.Bold,
                FontSize = 11,
                Foreground = (Brush)FindResource("TextBrush")
            };
            DockPanel.SetDock(issueNumText, Dock.Left);
            topHeader.Children.Add(issueNumText);

            var badgesPanel = new StackPanel { Orientation = Orientation.Horizontal };
            DockPanel.SetDock(badgesPanel, Dock.Right);

            if (node.IsGate)
            {
                var gateBadge = new Border
                {
                    Background = (Brush)FindResource("MauveBrush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(4, 0, 0, 0)
                };
                gateBadge.Child = new TextBlock { Text = "🛡️ GATE", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("BaseBrush") };
                badgesPanel.Children.Add(gateBadge);
            }

            if (node.IsDispatchable && node.IsOpen)
            {
                var dispBadge = new Border
                {
                    Background = (Brush)FindResource("GreenBrush"),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1),
                    Margin = new Thickness(4, 0, 0, 0)
                };
                dispBadge.Child = new TextBlock { Text = "⚡ READY", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("BaseBrush") };
                badgesPanel.Children.Add(dispBadge);
            }

            topHeader.Children.Add(badgesPanel);
            contentStack.Children.Add(topHeader);

            // Middle: Title
            var titleText = new TextBlock
            {
                Text = node.Title,
                FontSize = 11,
                Foreground = node.IsCompletedBlocker ? (Brush)FindResource("Overlay0Brush") : (Brush)FindResource("TextBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                Margin = new Thickness(0, 3, 0, 4)
            };
            contentStack.Children.Add(titleText);

            // Bottom Footer: Build Status & Labels
            var footer = new DockPanel { LastChildFill = false };

            if (!string.Equals(node.BuildStatus, "none", StringComparison.OrdinalIgnoreCase))
            {
                var bStatusBorder = new Border
                {
                    Background = GetBuildStatusBrush(node.BuildStatus),
                    CornerRadius = new CornerRadius(3),
                    Padding = new Thickness(4, 1, 4, 1)
                };
                DockPanel.SetDock(bStatusBorder, Dock.Left);
                bStatusBorder.Child = new TextBlock { Text = node.BuildStatus.ToUpperInvariant(), FontSize = 9, FontWeight = FontWeights.SemiBold, Foreground = (Brush)FindResource("BaseBrush") };
                footer.Children.Add(bStatusBorder);
            }

            if (node.Labels.Count > 0)
            {
                var lblText = new TextBlock
                {
                    Text = string.Join(" ", node.Labels.Take(2)),
                    FontSize = 9,
                    Foreground = (Brush)FindResource("Subtext0Brush"),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    MaxWidth = 100
                };
                DockPanel.SetDock(lblText, Dock.Right);
                footer.Children.Add(lblText);
            }

            contentStack.Children.Add(footer);

            grid.Children.Add(contentStack);
            cardBorder.Child = grid;

            // Click Handler for Chain Highlighting
            cardBorder.MouseDown += (s, e) =>
            {
                e.Handled = true;
                _selectedGraphIssue = node.IssueNumber;
                if (_activeGraphData != null)
                {
                    GitModeGraphService.ApplyChainHighlighting(_activeGraphData, _selectedGraphIssue, _activeChainMode);
                    RenderGraph(_activeGraphData);
                    UpdateGraphHeaderSummary();
                }
            };

            return cardBorder;
        }

        private Brush GetBucketBrush(string bucket)
        {
            if (bucket.Contains("Batter", StringComparison.OrdinalIgnoreCase)) return (Brush)FindResource("PeachBrush");
            if (bucket.Contains("Progress", StringComparison.OrdinalIgnoreCase)) return (Brush)FindResource("BlueBrush");
            if (bucket.Contains("Done", StringComparison.OrdinalIgnoreCase)) return (Brush)FindResource("GreenBrush");
            return (Brush)FindResource("Surface1Brush");
        }

        private Brush GetBuildStatusBrush(string status)
        {
            if (string.Equals(status, "success", StringComparison.OrdinalIgnoreCase)) return (Brush)FindResource("GreenBrush");
            if (string.Equals(status, "failed", StringComparison.OrdinalIgnoreCase)) return (Brush)FindResource("RedBrush");
            if (string.Equals(status, "running", StringComparison.OrdinalIgnoreCase)) return (Brush)FindResource("BlueBrush");
            return (Brush)FindResource("YellowBrush");
        }

        private void GraphCanvas_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.OriginalSource == GraphCanvas || e.OriginalSource is ScrollViewer)
            {
                _selectedGraphIssue = 0;
                if (_activeGraphData != null)
                {
                    GitModeGraphService.ApplyChainHighlighting(_activeGraphData, 0, _activeChainMode);
                    RenderGraph(_activeGraphData);
                    UpdateGraphHeaderSummary();
                }
            }
        }

        private void ChainMode_Click(object sender, RoutedEventArgs e)
        {
            if (sender is Button btn && btn.Tag is string tagStr)
            {
                if (Enum.TryParse<GitChainMode>(tagStr, out var mode))
                {
                    _activeChainMode = mode;
                    if (_activeGraphData != null && _selectedGraphIssue > 0)
                    {
                        GitModeGraphService.ApplyChainHighlighting(_activeGraphData, _selectedGraphIssue, _activeChainMode);
                        RenderGraph(_activeGraphData);
                        UpdateGraphHeaderSummary();
                    }
                }
            }
        }

        private async void GraphFilter_Changed(object sender, SelectionChangedEventArgs e)
        {
            if (!_loadedOnce) return;

            if (CmbBucketFilter.SelectedItem is ComboBoxItem bItem)
            {
                _bucketFilter = bItem.Content.ToString();
            }
            if (CmbBuildFilter.SelectedItem is ComboBoxItem buildItem)
            {
                _buildFilter = buildItem.Content.ToString();
            }

            await RefreshGraphAsync();
        }

        private async void BtnResetGraphFilters_Click(object sender, RoutedEventArgs e)
        {
            _milestoneFilter = null;
            _epicFilter = null;
            _bucketFilter = null;
            _buildFilter = null;
            _selectedGraphIssue = 0;

            CmbBucketFilter.SelectedIndex = 0;
            CmbBuildFilter.SelectedIndex = 0;

            await RefreshGraphAsync();
        }

        private TreeViewItem CreateTreeNodeView(GitModeTreeNode node)
        {
            var item = new TreeViewItem
            {
                Tag = node,
                IsExpanded = node.Type == GitModeNodeType.Milestone || node.Type == GitModeNodeType.Epic
            };

            item.Header = BuildNodeHeaderContent(node);

            foreach (var child in node.Children)
            {
                item.Items.Add(CreateTreeNodeView(child));
            }

            return item;
        }

        private FrameworkElement BuildNodeHeaderContent(GitModeTreeNode node)
        {
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
            await RefreshAllAsync();
        }

        private async void EpicTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
        {
            if (e.NewValue is TreeViewItem tvi && tvi.Tag is GitModeTreeNode node)
            {
                SelectedNode = node;
                NodeSelected?.Invoke(this, node);

                if (node.Type == GitModeNodeType.Milestone)
                {
                    _milestoneFilter = node.Id;
                    _epicFilter = null;
                }
                else if (node.Type == GitModeNodeType.Epic)
                {
                    _epicFilter = node.Id;
                    _milestoneFilter = null;
                }
                else
                {
                    _milestoneFilter = null;
                    _epicFilter = null;
                }

                await RefreshGraphAsync();
            }
        }
    }
}

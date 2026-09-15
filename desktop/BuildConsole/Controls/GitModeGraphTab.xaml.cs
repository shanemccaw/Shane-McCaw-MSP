using System;
using System.Linq;
using System.Threading;
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
    /// Git #4247 — the Git Mode Dependency Graph, extracted out of the old full-span
    /// GitModeContainer into its own native document tab (opened via MainWindow's
    /// AddSingletonDocumentTab / FocusExistingDocumentTab open-or-focus recipe).
    ///
    /// The graph RENDERING is unchanged — it still uses GitModeGraphService (Postgres),
    /// RenderGraph, and GitModeWhyEngine, ported verbatim from GitModeContainer. Only the
    /// container changed. Two real correctness fixes land here as part of the move
    /// (see #4247's "threading / UI-safety gaps"):
    ///   1. OnMirrorSyncCompleted's refresh runs inside a real try/catch that logs to
    ///      ActivityLog on failure — it is no longer a fire-and-forget async void with no
    ///      error path.
    ///   2. RefreshGraphAsync is guarded by a CancellationTokenSource swap so a superseded
    ///      refresh (a background mirror-sync tick landing mid-filter-change, or two rapid
    ///      refreshes) can never overwrite newer graph state with stale data.
    /// </summary>
    public partial class GitModeGraphTab : UserControl
    {
        private const string Channel = "git-mode.graph";

        /// <summary>Raised when a node is clicked, so MainWindow can load that issue's real
        /// detail into the right-hand GitModeIssueDetailPanel.</summary>
        public event Action<int>? IssueFocusRequested;

        private bool _loadedOnce;
        private GitModeGraphData? _activeGraphData;
        private GitChainMode _activeChainMode = GitChainMode.FullChain;
        private int _selectedGraphIssue = 0;

        private string? _bucketFilter;
        private string? _buildFilter;

        // Git #4247 — reentrancy guard: each RefreshGraphAsync cancels the previous one and
        // only commits its render if its own token is still current.
        private CancellationTokenSource? _refreshCts;

        public GitModeGraphTab()
        {
            InitializeComponent();
            Loaded += GitModeGraphTab_Loaded;
            Unloaded += GitModeGraphTab_Unloaded;
        }

        private async void GitModeGraphTab_Loaded(object sender, RoutedEventArgs e)
        {
            GitHubIssueMirror.SyncCompleted += OnMirrorSyncCompleted;
            if (_loadedOnce) return;
            _loadedOnce = true;
            await RefreshGraphAsync();
        }

        private void GitModeGraphTab_Unloaded(object sender, RoutedEventArgs e)
        {
            try { GitHubIssueMirror.SyncCompleted -= OnMirrorSyncCompleted; } catch { }
        }

        /// <summary>Git #4247 — was an implicit async-void lambda handed to InvokeAsync's Action
        /// overload, so any exception inside the refresh was unobserved. Now the refresh runs in a
        /// real try/catch that logs on failure.</summary>
        private void OnMirrorSyncCompleted()
        {
            Dispatcher.InvokeAsync(async () =>
            {
                try
                {
                    if (IsVisible)
                    {
                        await RefreshGraphAsync();
                    }
                }
                catch (Exception ex)
                {
                    ActivityLog.Log(Channel, $"mirror-sync graph refresh failed: {ex.Message}");
                }
            });
        }

        public async Task RefreshGraphAsync()
        {
            // Supersede any in-flight refresh.
            _refreshCts?.Cancel();
            var cts = new CancellationTokenSource();
            _refreshCts = cts;
            var token = cts.Token;

            TxtGraphFilterInfo.Text = "Loading...";

            GitModeGraphData data;
            try
            {
                data = await GitModeGraphService.LoadGraphFromPostgresAsync(
                    null,
                    null,
                    _bucketFilter,
                    _buildFilter,
                    false);
            }
            catch (Exception ex)
            {
                if (token.IsCancellationRequested || !ReferenceEquals(_refreshCts, cts)) return;
                ActivityLog.Log(Channel, $"graph load failed: {ex.Message}");
                TxtGraphFilterInfo.Text = "Load failed";
                return;
            }

            // A newer refresh started while we awaited — drop this stale result rather than
            // overwriting the newer state.
            if (token.IsCancellationRequested || !ReferenceEquals(_refreshCts, cts)) return;

            _activeGraphData = data;
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
            if (!string.IsNullOrWhiteSpace(_bucketFilter) && !_bucketFilter.Equals("All", StringComparison.OrdinalIgnoreCase))
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

                var pathFigure = new System.Windows.Media.PathFigure { StartPoint = edge.StartPoint };
                var bezier = new BezierSegment(edge.ControlPoint1, edge.ControlPoint2, edge.EndPoint, true);
                pathFigure.Segments.Add(bezier);

                var pathGeo = new PathGeometry();
                pathGeo.Figures.Add(pathFigure);

                var fromNode = data.Nodes.FirstOrDefault(n => n.IssueNumber == edge.FromIssue);
                var toNode = data.Nodes.FirstOrDefault(n => n.IssueNumber == edge.ToIssue);
                var edgeWhy = GitModeWhyEngine.AnalyzeEdge(edge, fromNode, toNode);

                var path = new Path
                {
                    Data = pathGeo,
                    Stroke = edgeBrush,
                    StrokeThickness = thickness,
                    Opacity = opacity,
                    ToolTip = $"💡 WHY CONNECTED: {edgeWhy.Summary}\n\n{edgeWhy.Explanation}"
                };

                GraphCanvas.Children.Add(path);

                var arrow = CreateArrowhead(edge.ControlPoint2, edge.EndPoint, edgeBrush, opacity);
                arrow.ToolTip = $"💡 WHY CONNECTED: {edgeWhy.Summary}\n\n{edgeWhy.Explanation}";
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
            // Detail param is null here — issue detail lives in the right GitModeIssueDetailPanel
            // (the real IssueDetailView), not in this graph tab. Same call shape the old container
            // used whenever a detail wasn't loaded for the node being drawn.
            var whyRes = GitModeWhyEngine.AnalyzeNode(node, _activeGraphData, null);

            var cardBorder = new Border
            {
                Width = node.Width,
                Height = node.Height,
                CornerRadius = new CornerRadius(6),
                BorderThickness = new Thickness(node.IsSelected ? 2 : 1),
                Padding = new Thickness(0),
                Cursor = Cursors.Hand,
                Tag = node,
                ToolTip = $"💡 WHY ANALYSIS — #{node.IssueNumber} '{node.Title}'\n\n" +
                          $"• WHY BLOCKED: {whyRes.WhyBlocked}\n" +
                          $"• WHAT IT BLOCKS: {whyRes.WhatItBlocks}\n" +
                          $"• BUILD STATUS: {whyRes.BuildRequirements}\n" +
                          $"• DISPATCHABILITY: {whyRes.Dispatchability}\n" +
                          $"• NEXT STEP: {whyRes.NextSteps}"
            };

            if (node.IsGate)
            {
                cardBorder.Background = (Brush)FindResource("Surface0Brush");
                cardBorder.BorderBrush = (Brush)FindResource("MauveBrush");
                cardBorder.BorderThickness = new Thickness(node.IsSelected ? 3 : 2);
            }
            else if (node.IsSelected)
            {
                cardBorder.Background = (Brush)FindResource("Surface0Brush");
                cardBorder.BorderBrush = (Brush)FindResource("MauveBrush");
                cardBorder.BorderThickness = new Thickness(2);
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

            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(node.IsGate ? 6 : 5) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var bucketBar = new Border
            {
                Background = node.IsGate ? (Brush)FindResource("MauveBrush") : GetBucketBrush(node.Bucket),
                CornerRadius = new CornerRadius(3, 0, 0, 3)
            };
            Grid.SetColumn(bucketBar, 0);
            grid.Children.Add(bucketBar);

            var contentStack = new StackPanel { Margin = new Thickness(8, 6, 8, 6) };
            Grid.SetColumn(contentStack, 1);

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

            if (node.IsOpen)
            {
                if (node.IsDispatchable)
                {
                    var dispBadge = new Border
                    {
                        Background = (Brush)FindResource("GreenBrush"),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(4, 1, 4, 1),
                        Margin = new Thickness(4, 0, 0, 0)
                    };
                    dispBadge.Child = new TextBlock { Text = "⚡ DISPATCHABLE", FontSize = 9, FontWeight = FontWeights.Bold, Foreground = (Brush)FindResource("BaseBrush") };
                    badgesPanel.Children.Add(dispBadge);
                }
                else
                {
                    var blockBadge = new Border
                    {
                        Background = (Brush)FindResource("Surface0Brush"),
                        CornerRadius = new CornerRadius(3),
                        Padding = new Thickness(4, 1, 4, 1),
                        Margin = new Thickness(4, 0, 0, 0)
                    };
                    blockBadge.Child = new TextBlock { Text = "🛑 BLOCKED", FontSize = 9, FontWeight = FontWeights.SemiBold, Foreground = (Brush)FindResource("RedBrush") };
                    badgesPanel.Children.Add(blockBadge);
                }
            }

            topHeader.Children.Add(badgesPanel);
            contentStack.Children.Add(topHeader);

            var titleText = new TextBlock
            {
                Text = node.Title,
                FontSize = 11,
                FontWeight = node.IsGate ? FontWeights.Bold : FontWeights.Normal,
                Foreground = node.IsGate ? (Brush)FindResource("MauveBrush") : (node.IsCompletedBlocker ? (Brush)FindResource("Overlay0Brush") : (Brush)FindResource("TextBrush")),
                TextTrimming = TextTrimming.CharacterEllipsis,
                Margin = new Thickness(0, 3, 0, 4)
            };
            contentStack.Children.Add(titleText);

            var footer = new DockPanel { LastChildFill = false };

            var bStatusBorder = new Border
            {
                Background = GetBuildStatusBrush(node.BuildStatus),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(4, 1, 4, 1)
            };
            DockPanel.SetDock(bStatusBorder, Dock.Left);

            string bLabelText = node.BuildStatus.ToLowerInvariant() switch
            {
                "built" => "✓ BUILT",
                "failed" => "❌ FAILED",
                "outdated" => "🔄 OUTDATED",
                "pending" => "⏳ PENDING",
                _ => "⚠️ MISSING"
            };

            Brush bLabelFg = (node.BuildStatus.Equals("missing", StringComparison.OrdinalIgnoreCase))
                ? (Brush)FindResource("Subtext0Brush")
                : (Brush)FindResource("BaseBrush");

            bStatusBorder.Child = new TextBlock { Text = bLabelText, FontSize = 9, FontWeight = FontWeights.SemiBold, Foreground = bLabelFg };
            footer.Children.Add(bStatusBorder);

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

                // The real issue detail loads in the right-hand panel via MainWindow.
                IssueFocusRequested?.Invoke(node.IssueNumber);
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
            var s = status.Trim().ToLowerInvariant();
            return s switch
            {
                "built" or "success" => (Brush)FindResource("GreenBrush"),
                "failed" or "error" => (Brush)FindResource("RedBrush"),
                "outdated" or "stale" => (Brush)FindResource("PeachBrush"),
                "pending" or "running" or "queued" => (Brush)FindResource("BlueBrush"),
                _ => (Brush)FindResource("Surface1Brush")
            };
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

        private async void BtnRefreshGraph_Click(object sender, RoutedEventArgs e)
        {
            await RefreshGraphAsync();
        }

        private async void BtnResetGraphFilters_Click(object sender, RoutedEventArgs e)
        {
            _bucketFilter = null;
            _buildFilter = null;
            _selectedGraphIssue = 0;

            CmbBucketFilter.SelectedIndex = 0;
            CmbBuildFilter.SelectedIndex = 0;

            await RefreshGraphAsync();
        }
    }
}

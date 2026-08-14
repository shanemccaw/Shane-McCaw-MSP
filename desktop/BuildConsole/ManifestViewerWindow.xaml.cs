using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Xml;
using BuildConsole.Services;
using ICSharpCode.AvalonEdit.Document;
using ICSharpCode.AvalonEdit.Folding;
using ICSharpCode.AvalonEdit.Highlighting;
using ICSharpCode.AvalonEdit.Highlighting.Xshd;

namespace BuildConsole
{
    /// <summary>
    /// Manifest viewer — a dedicated read-only window opened from the #952 steps flyout, giving one
    /// selected test manifest two complementary views:
    ///
    ///   1. RAW JSON — the manifest's real bytes on disk (NOT a re-serialization of the parsed object),
    ///      shown in AvalonEdit with JSON syntax highlighting (JsonSyntax.xshd, same real library #939
    ///      integrated for the SQL Runner) and collapsible object/array folding.
    ///
    ///   2. WORKFLOW CHART — a native-WPF-Canvas flowchart (boxes + connecting arrows, no external
    ///      diagramming library) of the manifest's ACTUAL execution flow, in the real fixed phase order
    ///      MainWindow.RunManifestAsync runs: apiTests → graphTests → postGraphApiTests → zohoTests →
    ///      uiSteps → powerShellVerify. Implicit setup boxes are drawn where a phase implies one (a
    ///      "Navigate to baseUrl" first box for uiSteps; a "Connect-MgGraph (delegated)" first box for
    ///      powerShellVerify, matching PowerShellTestExecutor.BuildScript). Each real step is its own box
    ///      labeled via the shared <see cref="ManifestStepDescriber"/> (the exact same #952 flyout
    ///      summarization), and captureResponse / extract / textContains are surfaced as badges rather
    ///      than hidden (Shane: "nothing in my UI indicates that it's testing the API").
    ///
    /// Pure viewing/display — no logging/telemetry wiring needed.
    /// </summary>
    public partial class ManifestViewerWindow : Window
    {
        private readonly TestManifest _manifest;
        private FoldingManager? _foldingManager;
        private bool _chartRendered;

        // ── Chart layout constants ──────────────────────────────────────────
        private const double BoxWidth = 360;
        private const double BoxLeft = 220;
        private const double CenterX = BoxLeft + BoxWidth / 2;   // vertical arrow spine
        private const double TopPad = 24;
        private const double BoxGap = 34;                        // vertical room between boxes for the arrow
        private const double GutterLeft = 14;                    // phase labels live in the left gutter
        private const double CanvasRightPad = 40;

        public ManifestViewerWindow(TestManifest manifest, bool showChartFirst = false)
        {
            _manifest = manifest ?? throw new ArgumentNullException(nameof(manifest));
            InitializeComponent();

            string fileName = string.IsNullOrEmpty(_manifest.SourcePath)
                ? "manifest.json"
                : System.IO.Path.GetFileName(_manifest.SourcePath);
            Title = $"Manifest Viewer — {fileName}";
            TxtFileName.Text = fileName;

            int total = _manifest.ApiTests.Count + _manifest.GraphTests.Count + _manifest.PostGraphApiTests.Count
                      + _manifest.ZohoTests.Count + _manifest.PowerShellVerify.Count + _manifest.UiSteps.Count;
            TxtSubtitle.Text = string.IsNullOrWhiteSpace(_manifest.Feature)
                ? $"{total} step(s)"
                : $"#{_manifest.Issue} · {_manifest.Feature} · {total} step(s)";

            LoadRawJson();
            BuildLegend();

            // "View Run Diagram" opens straight on the chart; "View Raw JSON" (and the flyout button) on JSON.
            if (showChartFirst) ShowChartView();
            else ShowJsonView();
        }

        // ── (1) Raw JSON view ───────────────────────────────────────────────

        /// <summary>Loads the manifest's REAL file content (the actual bytes on disk, not a re-serialized
        /// copy of the parsed object), applies JSON highlighting, and installs collapsible folding.</summary>
        private void LoadRawJson()
        {
            LoadJsonHighlighting();

            string raw;
            try
            {
                raw = File.ReadAllText(_manifest.SourcePath);
            }
            catch (Exception ex)
            {
                JsonEditor.Text = $"// Couldn't read {_manifest.SourcePath}:\n// {ex.Message}";
                return;
            }

            JsonEditor.Text = raw;
            InstallJsonFolding();
        }

        /// <summary>Applies JsonSyntax.xshd (embedded resource, dark-theme colors matching DarkTheme.xaml),
        /// same best-effort load SqlRunnerView uses (#939) — a missing/bad definition leaves the editor plain
        /// rather than crashing the viewer.</summary>
        private void LoadJsonHighlighting()
        {
            try
            {
                var asm = Assembly.GetExecutingAssembly();
                using var stream = asm.GetManifestResourceStream("BuildConsole.Controls.JsonSyntax.xshd");
                if (stream == null) return;
                using var reader = new XmlTextReader(stream);
                JsonEditor.SyntaxHighlighting = HighlightingLoader.Load(reader, HighlightingManager.Instance);
            }
            catch
            {
                // Cosmetic only.
            }
        }

        private void InstallJsonFolding()
        {
            _foldingManager = FoldingManager.Install(JsonEditor.TextArea);
            var foldings = CreateJsonFoldings(JsonEditor.Document).ToList();
            foldings.Sort((a, b) => a.StartOffset.CompareTo(b.StartOffset));
            _foldingManager.UpdateFoldings(foldings, -1);
        }

        /// <summary>Brace/bracket folding for JSON: one foldable region per matched {…} object and […] array
        /// that spans more than one line. String contents are skipped (respecting \-escapes) so a '{' or '['
        /// inside a string value never opens a phantom fold.</summary>
        private static IEnumerable<NewFolding> CreateJsonFoldings(TextDocument doc)
        {
            string text = doc.Text;
            var result = new List<NewFolding>();
            var stack = new Stack<int>();
            bool inString = false;

            for (int i = 0; i < text.Length; i++)
            {
                char c = text[i];

                if (inString)
                {
                    if (c == '\\') { i++; continue; }   // skip the escaped char
                    if (c == '"') inString = false;
                    continue;
                }

                switch (c)
                {
                    case '"':
                        inString = true;
                        break;
                    case '{':
                    case '[':
                        stack.Push(i);
                        break;
                    case '}':
                    case ']':
                        if (stack.Count > 0)
                        {
                            int start = stack.Pop();
                            // Only worth folding if it actually spans multiple lines.
                            if (doc.GetLineByOffset(start).LineNumber != doc.GetLineByOffset(i).LineNumber)
                                result.Add(new NewFolding(start, i + 1));
                        }
                        break;
                }
            }

            return result;
        }

        // ── View switching ──────────────────────────────────────────────────

        private void BtnViewJson_Click(object sender, RoutedEventArgs e) => ShowJsonView();
        private void BtnViewChart_Click(object sender, RoutedEventArgs e) => ShowChartView();

        private void ShowJsonView()
        {
            JsonPanel.Visibility = Visibility.Visible;
            ChartPanel.Visibility = Visibility.Collapsed;
            BtnViewJson.Style = (Style)FindResource("PrimaryButton");
            BtnViewChart.Style = (Style)FindResource("SecondaryButton");
        }

        private void ShowChartView()
        {
            if (!_chartRendered)
            {
                RenderWorkflow();
                _chartRendered = true;
            }
            JsonPanel.Visibility = Visibility.Collapsed;
            ChartPanel.Visibility = Visibility.Visible;
            BtnViewJson.Style = (Style)FindResource("SecondaryButton");
            BtnViewChart.Style = (Style)FindResource("PrimaryButton");
        }

        // ── (2) Workflow chart view ─────────────────────────────────────────

        private sealed record Badge(string Text, string BrushKey);

        private sealed class ChartNode
        {
            public string Label = "";
            public string BrushKey = "BlueBrush";
            public bool IsSetup;
            public List<Badge> Badges = new();
        }

        private sealed class PhaseGroup
        {
            public string Title = "";
            public string BrushKey = "BlueBrush";
            public int StepCount;                 // real declared steps (excludes implicit setup boxes)
            public List<ChartNode> Nodes = new();
        }

        /// <summary>Builds the phase groups in RunManifestAsync's real fixed order, then lays them out as a
        /// centered column of boxes joined by downward arrows, with the phase name in the left gutter beside
        /// each phase's first box.</summary>
        private void RenderWorkflow()
        {
            WorkflowCanvas.Children.Clear();
            var groups = BuildPhaseGroups();

            if (groups.Count == 0)
            {
                var empty = new TextBlock
                {
                    Text = "This manifest declares no executable steps.",
                    Foreground = (Brush)FindResource("Subtext0Brush"),
                    FontSize = 13,
                };
                Canvas.SetLeft(empty, GutterLeft);
                Canvas.SetTop(empty, TopPad);
                WorkflowCanvas.Children.Add(empty);
                WorkflowCanvas.Width = BoxLeft + BoxWidth + CanvasRightPad;
                WorkflowCanvas.Height = TopPad + 40;
                return;
            }

            double y = TopPad;
            Point? prevBottom = null;

            foreach (var group in groups)
            {
                bool firstInGroup = true;
                foreach (var node in group.Nodes)
                {
                    var box = BuildNodeBox(node);
                    box.Width = BoxWidth;
                    box.Measure(new Size(BoxWidth, double.PositiveInfinity));
                    double h = box.DesiredSize.Height;

                    Canvas.SetLeft(box, BoxLeft);
                    Canvas.SetTop(box, y);
                    WorkflowCanvas.Children.Add(box);

                    if (prevBottom.HasValue)
                        DrawArrow(prevBottom.Value, new Point(CenterX, y));

                    if (firstInGroup)
                    {
                        var header = BuildPhaseHeader(group);
                        Canvas.SetLeft(header, GutterLeft);
                        Canvas.SetTop(header, y);
                        WorkflowCanvas.Children.Add(header);
                        firstInGroup = false;
                    }

                    prevBottom = new Point(CenterX, y + h);
                    y += h + BoxGap;
                }
            }

            WorkflowCanvas.Width = BoxLeft + BoxWidth + CanvasRightPad;
            WorkflowCanvas.Height = y + 10;
        }

        /// <summary>The six real phases in RunManifestAsync order. Only phases actually present in the manifest
        /// produce a group; the uiSteps and powerShellVerify groups lead with their implicit setup box.</summary>
        private List<PhaseGroup> BuildPhaseGroups()
        {
            var groups = new List<PhaseGroup>();

            AddHttpGroup(groups, "apiTests", "BlueBrush", _manifest.ApiTests);
            AddHttpGroup(groups, "graphTests", "MauveBrush", _manifest.GraphTests);
            AddHttpGroup(groups, "postGraphApiTests", "BlueBrush", _manifest.PostGraphApiTests);
            AddHttpGroup(groups, "zohoTests", "GreenBrush", _manifest.ZohoTests);

            if (_manifest.UiSteps.Count > 0)
            {
                var nodes = new List<ChartNode>();
                string nav = string.IsNullOrWhiteSpace(_manifest.BaseUrl)
                    ? "Navigate to baseUrl (none declared)"
                    : $"Navigate to {_manifest.BaseUrl}";
                nodes.Add(new ChartNode { Label = nav, BrushKey = "PeachBrush", IsSetup = true });

                for (int i = 0; i < _manifest.UiSteps.Count; i++)
                {
                    var step = _manifest.UiSteps[i];
                    var badges = new List<Badge>();
                    if (!string.IsNullOrEmpty(step.CaptureResponseJson)) badges.Add(new Badge("captureResponse", "GreenBrush"));
                    if (!string.IsNullOrEmpty(step.ExtractJson)) badges.Add(new Badge("extract", "MauveBrush"));
                    if (!string.IsNullOrEmpty(step.TextContainsJson)) badges.Add(new Badge("textContains", "YellowBrush"));
                    if (!string.IsNullOrEmpty(step.TextPrefixOfAnyJson)) badges.Add(new Badge("textPrefixOfAny", "YellowBrush"));
                    nodes.Add(new ChartNode
                    {
                        Label = ManifestStepDescriber.DescribeUiStep(step, i),
                        BrushKey = "PeachBrush",
                        Badges = badges,
                    });
                }

                groups.Add(new PhaseGroup { Title = "uiSteps", BrushKey = "PeachBrush", StepCount = _manifest.UiSteps.Count, Nodes = nodes });
            }

            if (_manifest.PowerShellVerify.Count > 0)
            {
                var nodes = new List<ChartNode>();
                nodes.Add(new ChartNode { Label = "Connect-MgGraph (delegated)", BrushKey = "YellowBrush", IsSetup = true });

                for (int i = 0; i < _manifest.PowerShellVerify.Count; i++)
                {
                    var el = _manifest.PowerShellVerify[i];
                    var badges = new List<Badge>();
                    if (HasProperty(el, "compareField")) badges.Add(new Badge("compareField", "BlueBrush"));
                    nodes.Add(new ChartNode
                    {
                        Label = ManifestStepDescriber.DescribePowerShellEntry(el, i),
                        BrushKey = "YellowBrush",
                        Badges = badges,
                    });
                }

                groups.Add(new PhaseGroup { Title = "powerShellVerify", BrushKey = "YellowBrush", StepCount = _manifest.PowerShellVerify.Count, Nodes = nodes });
            }

            return groups;
        }

        private void AddHttpGroup(List<PhaseGroup> groups, string title, string brushKey, List<JsonElement> entries)
        {
            if (entries.Count == 0) return;

            var nodes = new List<ChartNode>();
            for (int i = 0; i < entries.Count; i++)
            {
                var badges = new List<Badge>();
                // extract is the one API-side annotation the label doesn't otherwise show; surface it.
                if (HasProperty(entries[i], "extract")) badges.Add(new Badge("extract", "MauveBrush"));
                nodes.Add(new ChartNode
                {
                    Label = ManifestStepDescriber.DescribeHttpEntry(entries[i], i),
                    BrushKey = brushKey,
                    Badges = badges,
                });
            }

            groups.Add(new PhaseGroup { Title = title, BrushKey = brushKey, StepCount = entries.Count, Nodes = nodes });
        }

        private static bool HasProperty(JsonElement el, string prop) =>
            el.ValueKind == JsonValueKind.Object && el.TryGetProperty(prop, out _);

        /// <summary>One step/setup box: an accent-outlined card with the step label, an "(implicit setup)"
        /// subtitle for setup boxes, and a row of annotation badges when the step declares any.</summary>
        private Border BuildNodeBox(ChartNode node)
        {
            var accent = (Brush)FindResource(node.BrushKey);
            var panel = new StackPanel();

            panel.Children.Add(new TextBlock
            {
                Text = node.Label,
                Foreground = (Brush)FindResource("TextBrush"),
                FontFamily = new FontFamily("Cascadia Code, Consolas, Courier New"),
                FontSize = 12,
                TextWrapping = TextWrapping.Wrap,
            });

            if (node.IsSetup)
            {
                panel.Children.Add(new TextBlock
                {
                    Text = "(implicit setup)",
                    Foreground = (Brush)FindResource("Subtext0Brush"),
                    FontSize = 10,
                    FontStyle = FontStyles.Italic,
                    Margin = new Thickness(0, 3, 0, 0),
                });
            }

            if (node.Badges.Count > 0)
            {
                var badgeRow = new WrapPanel { Margin = new Thickness(0, 6, 0, 0) };
                foreach (var badge in node.Badges)
                    badgeRow.Children.Add(MakeBadgePill(badge.Text, badge.BrushKey));
                panel.Children.Add(badgeRow);
            }

            return new Border
            {
                Background = (Brush)FindResource(node.IsSetup ? "MantleBrush" : "Surface0Brush"),
                BorderBrush = accent,
                BorderThickness = new Thickness(node.IsSetup ? 1 : 1.5),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10, 8, 10, 8),
                Child = panel,
            };
        }

        /// <summary>A small pill badge (colored text + thin accent outline) marking an otherwise-hidden
        /// per-step annotation (captureResponse / extract / textContains / …).</summary>
        private Border MakeBadgePill(string text, string brushKey)
        {
            var accent = (Brush)FindResource(brushKey);
            return new Border
            {
                Background = (Brush)FindResource("Surface1Brush"),
                BorderBrush = accent,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(6, 1, 6, 1),
                Margin = new Thickness(0, 0, 5, 0),
                Child = new TextBlock
                {
                    Text = text,
                    Foreground = accent,
                    FontSize = 10,
                    FontWeight = FontWeights.SemiBold,
                },
            };
        }

        /// <summary>The phase name + declared step count, shown in the left gutter beside the phase's first box.</summary>
        private FrameworkElement BuildPhaseHeader(PhaseGroup group)
        {
            var accent = (Brush)FindResource(group.BrushKey);
            var sp = new StackPanel { MaxWidth = BoxLeft - GutterLeft - 14 };
            sp.Children.Add(new TextBlock
            {
                Text = group.Title,
                Foreground = accent,
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                TextWrapping = TextWrapping.Wrap,
            });
            sp.Children.Add(new TextBlock
            {
                Text = $"{group.StepCount} step{(group.StepCount == 1 ? "" : "s")}",
                Foreground = (Brush)FindResource("Subtext0Brush"),
                FontSize = 10,
                Margin = new Thickness(0, 1, 0, 0),
            });
            return sp;
        }

        /// <summary>A downward connector: a thin vertical line from the previous box's bottom-center to the
        /// next box's top-center, capped with a filled arrowhead.</summary>
        private void DrawArrow(Point from, Point to)
        {
            var stroke = (Brush)FindResource("Surface2Brush");

            WorkflowCanvas.Children.Add(new Line
            {
                X1 = from.X,
                Y1 = from.Y,
                X2 = to.X,
                Y2 = to.Y - 2,
                Stroke = stroke,
                StrokeThickness = 1.6,
            });

            WorkflowCanvas.Children.Add(new Polygon
            {
                Fill = stroke,
                Points = new PointCollection
                {
                    new Point(to.X - 5, to.Y - 8),
                    new Point(to.X + 5, to.Y - 8),
                    new Point(to.X, to.Y - 1),
                },
            });
        }

        /// <summary>Legend strip explaining the flow direction, the badge colors, and the implicit-setup box.</summary>
        private void BuildLegend()
        {
            ChartLegend.Children.Add(new TextBlock
            {
                Text = "Executes top → bottom:",
                Foreground = (Brush)FindResource("Subtext1Brush"),
                FontSize = 11,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(0, 0, 10, 0),
            });

            AddLegendPill("extract", "MauveBrush");
            AddLegendPill("captureResponse", "GreenBrush");
            AddLegendPill("textContains", "YellowBrush");
            AddLegendPill("compareField", "BlueBrush");

            ChartLegend.Children.Add(new TextBlock
            {
                Text = "  •  muted \"(implicit setup)\" boxes are added by the runner",
                Foreground = (Brush)FindResource("Subtext0Brush"),
                FontSize = 11,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(6, 0, 0, 0),
            });
        }

        private void AddLegendPill(string text, string brushKey)
        {
            var pill = MakeBadgePill(text, brushKey);
            pill.VerticalAlignment = VerticalAlignment.Center;
            ChartLegend.Children.Add(pill);
        }

        // ── Custom title bar (same pattern as TestHistoryWindow, Git #1006) ──
        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            WindowChromeHelper.Setup(this);
        }

        private void BtnMinimize_Click(object sender, RoutedEventArgs e) => WindowState = WindowState.Minimized;

        private void BtnMaximizeRestore_Click(object sender, RoutedEventArgs e) =>
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

        private void BtnCloseWindow_Click(object sender, RoutedEventArgs e) => Close();

        private void Window_StateChanged(object sender, EventArgs e)
        {
            bool maximized = WindowState == WindowState.Maximized;
            BtnMaximizeRestoreIcon.Text = maximized ? "\uE923" : "\uE922";
            BtnMaximizeRestore.ToolTip = maximized ? "Restore Down" : "Maximize";
        }
    }
}

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    // ══════════════════════════════════════════════════════════════════════
    // Git #2798 — Git Doctor, the full-capability ActivityBar view. A real port
    // of ShaneBuilder's landed GitDoctorDock document (Feature #2194): every
    // finding, branch and commit lookup here comes from GitDoctorService running
    // real git against the actual repo this executable lives inside. There is no
    // seeded/demo data path — an empty findings list means the repo really is
    // clean, not that data hasn't loaded.
    //
    // Audit adaptations from ShaneBuilder (per #2798's "verify each capability
    // against BuildConsole's actual repo/paths/PAT storage" instruction):
    //   • PAT storage — ShaneBuilder's paste-PAT card wrote SettingsStore's
    //     "secret:token:github" key; BuildConsole keeps its PAT in
    //     BuildConsoleSettings.GitHubPat (%AppData%\BuildConsole\settings.json,
    //     the same store GitHubApiClient reads), so ApplyPastedPat writes there.
    //   • Theming — ShaneBuilder's Brush.*/FontFamily.*/FontSize.*/FontWeight.*
    //     semantic resource keys are registered into this control's Resources in
    //     the ctor (mapped to BuildConsole's Catppuccin palette) so the ported
    //     render code resolves them unchanged.
    //   • The chat-tool-rail MINI panel (ShaneBuilder's GdMiniPanel) is a
    //     separate sibling issue and is deliberately NOT ported here — only the
    //     full document's render/plan/log/bridge paths.
    //
    // "Ask Claude" / "send all findings" copy markdown to the clipboard and
    // toast rather than injecting into a chat composer: this full document does
    // not sit next to an app-owned composer (that is the mini panel's job).
    // ══════════════════════════════════════════════════════════════════════
    public partial class GitDoctorView : UserControl
    {
        private readonly GitDoctorService _gitDoctorService = new();
        private IReadOnlyList<GitDoctorFinding> _gdFindings = Array.Empty<GitDoctorFinding>();
        private IReadOnlyList<GitDoctorBranch> _gdBranches = Array.Empty<GitDoctorBranch>();
        private GitDoctorRepoStatus? _gdRepoStatus;
        private string? _gdSelectedFindingId;
        private readonly Dictionary<string, string> _gdRemedyChoice = new();
        private readonly Dictionary<string, bool> _gdBranchSelection = new();
        private string _gdBranchFilter = "merged";
        private bool _gdLoaded;
        private bool _gdLoading;
        private bool _gdRunning;
        private readonly List<(string Text, string? Why, bool IsHead)> _gdLog = new();
        private GitDoctorCommitInfo? _gdLookupResult;
        private bool _gdLookupNotFound;
        private string _gdLookupQueryShown = "";
        private List<(string Cmd, bool Approved)> _gdPlan = new();
        private bool _gdPasteBusy;

        public GitDoctorView()
        {
            RegisterThemeResources();
            InitializeComponent();
        }

        // ShaneBuilder's ported render code looks up semantic keys via FindResource;
        // map each to BuildConsole's Catppuccin palette / real fonts so nothing in
        // that code has to change. Registered before InitializeComponent so the XAML
        // (which uses BuildConsole keys directly) and the code-behind both resolve.
        private void RegisterThemeResources()
        {
            void B(string key, string hex)
            {
                var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
                brush.Freeze();
                Resources[key] = brush;
            }

            B("Brush.Bg.Card", "#1C2128");
            B("Brush.Bg.Chip", "#313244");
            B("Brush.Bg.Window", "#0D1117");
            B("Brush.Border.Card", "#313244");
            B("Brush.Border.Strong", "#45475A");
            B("Brush.Claude.Accent", "#FAB387");
            B("Brush.Epic.AppCore", "#89B4FA");
            B("Brush.Epic.Gate", "#F38BA8");
            B("Brush.LogSource.Console", "#94E2D5");
            B("Brush.NextUp.NoBuild.Fg", "#A6ADC8");
            B("Brush.Status.Running", "#A6E3A1");
            B("Brush.Text.Dim", "#6C7086");
            B("Brush.Text.Heading", "#CDD6F4");
            B("Brush.Text.Muted", "#A6ADC8");
            B("Brush.Text.Primary", "#CDD6F4");

            Resources["FontFamily.Sans"] = new FontFamily("Segoe UI");
            Resources["FontFamily.Monospace"] = new FontFamily("Consolas");

            Resources["FontWeight.Bold"] = FontWeights.SemiBold;
            Resources["FontWeight.ExtraBold"] = FontWeights.Bold;

            foreach (var s in new[] { 8.0, 8.5, 9.0, 9.5, 10.0, 10.5, 11.0, 11.5, 12.0, 12.5, 13.0, 14.0, 15.0 })
                Resources["FontSize." + s.ToString(CultureInfo.InvariantCulture)] = s;
        }

        /// <summary>Called by LeftSidebar the first time the Git Doctor rail icon is
        /// selected — kicks the real checks off exactly once. Safe to call repeatedly.</summary>
        public void EnsureLoaded() => _ = EnsureGitDoctorLoadedAsync();

        private async Task EnsureGitDoctorLoadedAsync()
        {
            if (_gdLoaded || _gdLoading) return;
            await LoadGitDoctorChecksAsync();
        }

        private void BtnGitDoctorRecheck_Click(object sender, RoutedEventArgs e) => _ = LoadGitDoctorChecksAsync();

        private async Task LoadGitDoctorChecksAsync()
        {
            _gdLoading = true;
            GitDoctorHeadline.Text = "Checking git…";
            GitDoctorSubline.Text = "";

            _gdRepoStatus = await _gitDoctorService.GetRepoStatusAsync();
            _gdFindings = await _gitDoctorService.RunChecksAsync();
            _gdBranches = _gdFindings.Any(f => f.ShowsBranches) ? await _gitDoctorService.ComputeBranchesAsync() : Array.Empty<GitDoctorBranch>();

            _gdLoaded = true;
            _gdLoading = false;
            _gdSelectedFindingId = _gdFindings.FirstOrDefault(f => !f.Fixed)?.CheckId ?? _gdFindings.FirstOrDefault()?.CheckId;
            _gdLookupResult = null;
            _gdLookupNotFound = false;
            RenderGitDoctor();
        }

        private void RenderGitDoctor()
        {
            var open = _gdFindings.Where(f => !f.Fixed).ToList();
            var repo = _gdRepoStatus;

            GitDoctorHeadline.Text = open.Count > 0
                ? $"{open.Count} thing{(open.Count == 1 ? " is" : "s are")} blocking git right now"
                : (_gdLoaded ? "Everything git was complaining about is fixed" : "");
            GitDoctorSubline.Text = repo != null
                ? $"{repo.Repo} · {repo.Branch} · {repo.Ahead} ahead · {repo.Behind} behind · {repo.Worktrees} worktrees"
                : "";

            GitDoctorNightmareLabel.Text = open.Count > 0 ? "End this git nightmare" : "Nothing left to fix";
            BtnGitDoctorNightmare.IsEnabled = open.Count > 0;
            BtnGitDoctorNightmare.Background = open.Count > 0
                ? (Brush)FindResource("Brush.Epic.Gate")
                : (Brush)FindResource("Brush.Bg.Card");
            GitDoctorNightmareLabel.Foreground = open.Count > 0 ? Brushes.Black : (Brush)FindResource("Brush.Text.Dim");
            int totalSteps = open.Sum(f => RemedyFor(f)?.Steps.Count ?? 0);
            GitDoctorNightmareSub.Text = open.Count > 0 ? $"backup branch first, then {totalSteps} commands" : "run a fresh check any time";
            GitDoctorOpenCount.Text = open.Count.ToString();

            RenderGitDoctorFindingsList();
            RenderGitDoctorDetail();
            RenderGitDoctorLog();
        }

        private GitDoctorRemedy? RemedyFor(GitDoctorFinding f)
        {
            if (_gdRemedyChoice.TryGetValue(f.CheckId, out var pick))
            {
                var m = f.Remedies.FirstOrDefault(r => r.Id == pick);
                if (m != null) return m;
            }
            return f.Remedies.FirstOrDefault(r => r.Recommended) ?? f.Remedies.FirstOrDefault();
        }

        private Brush SeverityBrush(GitDoctorSeverity s) => s switch
        {
            GitDoctorSeverity.Low => (Brush)FindResource("Brush.NextUp.NoBuild.Fg"),
            GitDoctorSeverity.Medium => (Brush)FindResource("Brush.Epic.AppCore"),
            _ => (Brush)FindResource("Brush.Epic.Gate")
        };

        private Brush RiskBrush(GitDoctorRisk r) => r switch
        {
            GitDoctorRisk.Safe => (Brush)FindResource("Brush.Status.Running"),
            GitDoctorRisk.Careful => (Brush)FindResource("Brush.Epic.AppCore"),
            _ => (Brush)FindResource("Brush.Epic.Gate")
        };

        private void RenderGitDoctorFindingsList() => RenderGitDoctorFindingsList(GitDoctorFindingsPanel);

        private void RenderGitDoctorFindingsList(StackPanel target)
        {
            target.Children.Clear();

            if (!_gdLoaded)
            {
                target.Children.Add(new TextBlock
                {
                    Text = "Running checks…", Margin = new Thickness(8),
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
                    Foreground = (Brush)FindResource("Brush.Text.Dim")
                });
                return;
            }

            if (_gdFindings.Count == 0)
            {
                target.Children.Add(new TextBlock
                {
                    Text = "No findings. Git is clean.", Margin = new Thickness(8), TextWrapping = TextWrapping.Wrap,
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11"),
                    Foreground = (Brush)FindResource("Brush.Text.Dim")
                });
                return;
            }

            foreach (var f in _gdFindings)
            {
                bool selected = f.CheckId == _gdSelectedFindingId && _gdLookupResult == null && !_gdLookupNotFound;
                var row = new Border
                {
                    Padding = new Thickness(8, 7, 8, 7),
                    Margin = new Thickness(0, 0, 0, 2),
                    CornerRadius = new CornerRadius(7),
                    Cursor = Cursors.Hand,
                    Opacity = f.Fixed ? 0.5 : 1.0,
                    Background = selected ? (Brush)FindResource("Brush.Bg.Chip") : Brushes.Transparent,
                    BorderThickness = new Thickness(2, 0, 0, 0),
                    BorderBrush = selected ? SeverityBrush(f.Severity) : Brushes.Transparent
                };

                var textCol = new StackPanel { Width = double.NaN };
                textCol.Children.Add(new TextBlock
                {
                    Text = f.Title, TextTrimming = TextTrimming.CharacterEllipsis,
                    TextDecorations = f.Fixed ? TextDecorations.Strikethrough : null,
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"),
                    FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                    Foreground = f.Fixed ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Text.Heading")
                });
                textCol.Children.Add(new TextBlock
                {
                    Text = f.Where, TextTrimming = TextTrimming.CharacterEllipsis,
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = (double)FindResource("FontSize.9"),
                    Foreground = (Brush)FindResource("Brush.Text.Dim")
                });

                var grid = new Grid();
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var sev = new Border
                {
                    CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1),
                    Background = new SolidColorBrush(((SolidColorBrush)SeverityBrush(f.Severity)).Color) { Opacity = 0.16 },
                    Child = new TextBlock
                    {
                        Text = f.Severity.ToString().ToUpperInvariant(),
                        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 8,
                        FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"),
                        Foreground = SeverityBrush(f.Severity)
                    }
                };

                var ellipse = new Ellipse { Width = 7, Height = 7, VerticalAlignment = VerticalAlignment.Center, Fill = f.Fixed ? (Brush)FindResource("Brush.Status.Running") : SeverityBrush(f.Severity) };
                Grid.SetColumn(ellipse, 0);
                var textColWrap = new Border { Margin = new Thickness(8, 0, 8, 0), Child = textCol };
                Grid.SetColumn(textColWrap, 1);
                Grid.SetColumn(sev, 2);
                grid.Children.Add(ellipse);
                grid.Children.Add(textColWrap);
                grid.Children.Add(sev);

                row.Child = grid;
                var capturedId = f.CheckId;
                row.MouseLeftButtonDown += (s, e) => SelectGitDoctorFinding(capturedId);
                target.Children.Add(row);
            }
        }

        private void SelectGitDoctorFinding(string checkId)
        {
            _gdSelectedFindingId = checkId;
            _gdLookupResult = null;
            _gdLookupNotFound = false;
            GitDoctorQueryBox.Text = "";
            RenderGitDoctorFindingsList();
            RenderGitDoctorDetail();
        }

        private TextBlock GdLabel(string text) => new()
        {
            Text = text, Margin = new Thickness(0, 0, 0, 5),
            FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.8.5"),
            FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Dim")
        };

        private void RenderGitDoctorDetail()
        {
            GitDoctorDetailPanel.Children.Clear();

            if (_gdLookupNotFound)
            {
                RenderGitDoctorLookupNotFound();
                return;
            }
            if (_gdLookupResult != null)
            {
                RenderGitDoctorLookupResult(_gdLookupResult);
                return;
            }

            var sel = _gdFindings.FirstOrDefault(f => f.CheckId == _gdSelectedFindingId);
            if (sel == null)
            {
                GitDoctorDetailPanel.Children.Add(new TextBlock
                {
                    Text = _gdLoaded ? "Nothing to show — pick a finding above." : "Running checks against the real repo…",
                    TextWrapping = TextWrapping.Wrap,
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"),
                    Foreground = (Brush)FindResource("Brush.Text.Dim")
                });
                return;
            }

            var header = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 9) };
            header.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(4), Padding = new Thickness(7, 3, 7, 3), Margin = new Thickness(0, 0, 9, 0),
                Background = new SolidColorBrush(((SolidColorBrush)SeverityBrush(sel.Severity)).Color) { Opacity = 0.16 },
                BorderBrush = SeverityBrush(sel.Severity), BorderThickness = new Thickness(1),
                Child = new TextBlock { Text = sel.Severity.ToString().ToUpperInvariant(), FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = SeverityBrush(sel.Severity) }
            });
            header.Children.Add(new TextBlock
            {
                Text = sel.Title, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 9, 0),
                TextWrapping = TextWrapping.Wrap,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.15"),
                FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Heading")
            });
            header.Children.Add(new TextBlock
            {
                Text = sel.Where, VerticalAlignment = VerticalAlignment.Center,
                FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = (double)FindResource("FontSize.10"),
                Foreground = (Brush)FindResource("Brush.Text.Dim")
            });
            GitDoctorDetailPanel.Children.Add(header);

            GitDoctorDetailPanel.Children.Add(new TextBlock
            {
                Text = sel.PlainEnglish, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12.5"),
                Foreground = (Brush)FindResource("Brush.Text.Primary")
            });

            GitDoctorDetailPanel.Children.Add(GdLabel("WHAT GIT ACTUALLY SAID"));
            GitDoctorDetailPanel.Children.Add(new Border
            {
                Padding = new Thickness(10, 9, 10, 9), CornerRadius = new CornerRadius(7), Margin = new Thickness(0, 0, 0, 14),
                Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = sel.RawGitOutput, TextWrapping = TextWrapping.Wrap,
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = (double)FindResource("FontSize.11"),
                    Foreground = new SolidColorBrush(Color.FromRgb(0xF0, 0xC9, 0xC2))
                }
            });

            if (sel.ShowsBranches)
                RenderGitDoctorBranchSection(sel);

            GitDoctorDetailPanel.Children.Add(GdLabel("HOW TO GET OUT OF IT"));
            var chosen = RemedyFor(sel);
            foreach (var r in sel.Remedies)
            {
                bool active = chosen?.Id == r.Id;
                var card = new Border
                {
                    Padding = new Thickness(11, 10, 11, 10), CornerRadius = new CornerRadius(8), Cursor = Cursors.Hand,
                    Margin = new Thickness(0, 0, 0, 7),
                    Background = active ? new SolidColorBrush(((SolidColorBrush)RiskBrush(r.Risk)).Color) { Opacity = 0.07 } : (Brush)FindResource("Brush.Bg.Card"),
                    BorderBrush = active ? RiskBrush(r.Risk) : (Brush)FindResource("Brush.Border.Card"),
                    BorderThickness = new Thickness(1)
                };
                var body = new StackPanel();
                var top = new StackPanel { Orientation = Orientation.Horizontal };
                top.Children.Add(new Ellipse
                {
                    Width = 12, Height = 12, Margin = new Thickness(0, 0, 8, 0),
                    Stroke = active ? RiskBrush(r.Risk) : (Brush)FindResource("Brush.Border.Strong"),
                    Fill = active ? RiskBrush(r.Risk) : Brushes.Transparent, StrokeThickness = 1
                });
                top.Children.Add(new TextBlock
                {
                    Text = r.Label, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0),
                    TextWrapping = TextWrapping.Wrap,
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"),
                    FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading")
                });
                if (r.Recommended)
                    top.Children.Add(new Border
                    {
                        CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(0, 0, 8, 0),
                        Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Status.Running")).Color) { Opacity = 0.16 },
                        Child = new TextBlock { Text = "RECOMMENDED", FontSize = 8, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Status.Running") }
                    });
                top.Children.Add(new Border
                {
                    CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1),
                    Background = new SolidColorBrush(((SolidColorBrush)RiskBrush(r.Risk)).Color) { Opacity = 0.16 },
                    Child = new TextBlock { Text = r.Risk.ToString().ToUpperInvariant(), FontSize = 8, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = RiskBrush(r.Risk) }
                });
                body.Children.Add(top);
                body.Children.Add(new TextBlock
                {
                    Text = r.Preserves, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(20, 6, 0, 8),
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
                    Foreground = (Brush)FindResource("Brush.Text.Muted")
                });
                foreach (var st in r.Steps)
                {
                    var stepRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(20, 0, 0, 3) };
                    stepRow.Children.Add(new TextBlock
                    {
                        Text = st.Cmd, Margin = new Thickness(0, 0, 9, 0), TextWrapping = TextWrapping.Wrap,
                        FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = (double)FindResource("FontSize.10.5"),
                        Foreground = new SolidColorBrush(Color.FromRgb(0x7D, 0xC4, 0xF5))
                    });
                    stepRow.Children.Add(new TextBlock
                    {
                        Text = st.Why, TextTrimming = TextTrimming.CharacterEllipsis,
                        FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.9.5"),
                        Foreground = (Brush)FindResource("Brush.Text.Dim")
                    });
                    body.Children.Add(stepRow);
                }
                card.Child = body;
                var capturedR = r.Id;
                card.MouseLeftButtonDown += (s, e) => { _gdRemedyChoice[sel.CheckId] = capturedR; RenderGitDoctorDetail(); };
                GitDoctorDetailPanel.Children.Add(card);
            }

            if (sel.CheckId == "auth")
                GitDoctorDetailPanel.Children.Add(BuildGitDoctorPastePatCard(sel));

            var actions = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 4, 0, 0) };
            var runBtn = new Button
            {
                Content = sel.Fixed ? "Run it again" : "Run this fix", Height = 32, Padding = new Thickness(14, 0, 14, 0), Margin = new Thickness(0, 0, 6, 0),
                Background = chosen != null ? RiskBrush(chosen.Risk) : (Brush)FindResource("Brush.Status.Running"), Foreground = Brushes.Black,
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"),
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"), BorderThickness = new Thickness(0), Cursor = Cursors.Hand
            };
            runBtn.Click += (s, e) => _ = RunGitDoctorRemedyAsync(sel);
            actions.Children.Add(runBtn);

            var askBtn = new Button
            {
                Content = "Ask Claude", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 0),
                Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Claude.Accent")).Color) { Opacity = 0.13 },
                Foreground = (Brush)FindResource("Brush.Claude.Accent"), BorderBrush = (Brush)FindResource("Brush.Claude.Accent"),
                BorderThickness = new Thickness(1), FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"),
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand
            };
            askBtn.Click += (s, e) => AskClaudeAboutFinding(sel);
            actions.Children.Add(askBtn);

            var copyBtn = new Button
            {
                Content = "Copy plan JSON", Height = 32, Padding = new Thickness(12, 0, 12, 0),
                Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Muted"),
                BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"), Cursor = Cursors.Hand
            };
            copyBtn.Click += (s, e) => CopyFindingPlanJson(sel);
            actions.Children.Add(copyBtn);

            GitDoctorDetailPanel.Children.Add(actions);
        }

        // Git #2205 — paste-a-fresh-PAT field on Git Doctor's auth finding. An alternative to the
        // "Re-authenticate with a fresh PAT" remedy's OS browser login flow: applies the pasted PAT
        // directly as the git credential and writes it to BuildConsoleSettings.GitHubPat (the store
        // GitHubApiClient reads), so both surfaces stay in sync.
        private Border BuildGitDoctorPastePatCard(GitDoctorFinding sel)
        {
            var card = new Border
            {
                Padding = new Thickness(11, 10, 11, 10), CornerRadius = new CornerRadius(8),
                Margin = new Thickness(0, 0, 0, 7),
                Background = (Brush)FindResource("Brush.Bg.Card"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1),
            };
            var body = new StackPanel();
            body.Children.Add(new TextBlock
            {
                Text = "Or paste a fresh PAT directly", Margin = new Thickness(0, 0, 0, 3),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.12"),
                FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Foreground = (Brush)FindResource("Brush.Text.Heading"),
            });
            body.Children.Add(new TextBlock
            {
                Text = "Applies it as the real git credential and saves it to BuildConsole Settings, no browser login.",
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 7),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.10.5"),
                Foreground = (Brush)FindResource("Brush.Text.Muted"),
            });

            var row = new DockPanel();
            var patBox = new PasswordBox
            {
                Height = 28, Padding = new Thickness(8, 0, 8, 0), VerticalContentAlignment = VerticalAlignment.Center,
                Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"),
                Foreground = (Brush)FindResource("Brush.Text.Primary"), FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
            };
            var applyBtn = new Button
            {
                Content = "Apply", Height = 28, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(6, 0, 0, 0),
                Background = (Brush)FindResource("Brush.Status.Running"), Foreground = Brushes.Black, BorderThickness = new Thickness(0),
                FontSize = 11, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand,
            };
            DockPanel.SetDock(applyBtn, Dock.Right);
            applyBtn.Click += (s, e) => _ = ApplyGitDoctorPastedPatAsync(sel, patBox.Password, applyBtn);
            row.Children.Add(applyBtn);
            row.Children.Add(patBox);
            body.Children.Add(row);

            card.Child = body;
            return card;
        }

        private async Task ApplyGitDoctorPastedPatAsync(GitDoctorFinding sel, string pat, Button applyBtn)
        {
            if (_gdPasteBusy) return;
            if (string.IsNullOrWhiteSpace(pat))
            {
                ToastEngine.Show("Git Doctor", "Paste a PAT first.", ToastKind.Warning);
                return;
            }

            _gdPasteBusy = true;
            applyBtn.IsEnabled = false;
            try
            {
                var (success, output) = await _gitDoctorService.ApplyGitHubPatAsync(pat);
                if (success)
                {
                    // BuildConsole's own PAT store (settings.json GitHubPat) — the same key
                    // GitHubApiClient reads. #2770-safe: Load()+Save() round-trip, not a torn write.
                    var settings = BuildConsole.Services.BuildConsoleSettings.Load();
                    settings.GitHubPat = pat.Trim();
                    settings.Save();
                    sel.Fixed = true;
                    ToastEngine.Show("Git Doctor", output, ToastKind.Success);
                    await LoadGitDoctorChecksAsync();
                }
                else
                {
                    ToastEngine.Show("Git Doctor", $"PAT rejected — {output}", ToastKind.Error);
                }
            }
            finally
            {
                _gdPasteBusy = false;
            }
        }

        private void RenderGitDoctorBranchSection(GitDoctorFinding sel)
        {
            GitDoctorDetailPanel.Children.Add(GdLabel("THE BRANCHES"));

            var filters = new WrapPanel { Margin = new Thickness(0, 0, 0, 7) };
            (string Id, string Label, Func<GitDoctorBranch, bool> Pred)[] defs =
            {
                ("all", "All", _ => true),
                ("merged", "Merged", b => b.Merged),
                ("unmerged", "Unmerged", b => !b.Merged),
                ("gone", "Remote gone", b => b.RemoteGone),
                ("old", "Older than 90 d", b => b.AgeDays > 90)
            };
            foreach (var (id, label, pred) in defs)
            {
                int count = _gdBranches.Count(pred);
                bool active = _gdBranchFilter == id;
                var pill = new Border
                {
                    Padding = new Thickness(9, 3, 9, 3), Margin = new Thickness(0, 0, 5, 5), CornerRadius = new CornerRadius(6), Cursor = Cursors.Hand,
                    Background = active ? new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Epic.AppCore")).Color) { Opacity = 0.14 } : Brushes.Transparent,
                    BorderBrush = active ? (Brush)FindResource("Brush.Epic.AppCore") : (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1),
                    Child = new TextBlock
                    {
                        Text = $"{label} ({count})", FontSize = 10, FontWeight = (FontWeight)FindResource("FontWeight.Bold"),
                        Foreground = active ? (Brush)FindResource("Brush.Epic.AppCore") : (Brush)FindResource("Brush.Text.Muted")
                    }
                };
                var capturedId = id;
                pill.MouseLeftButtonDown += (s, e) => { _gdBranchFilter = capturedId; RenderGitDoctorDetail(); };
                filters.Children.Add(pill);
            }
            GitDoctorDetailPanel.Children.Add(filters);

            var filterDef = defs.First(d => d.Id == _gdBranchFilter);
            var filtered = _gdBranches.Where(filterDef.Pred).Take(60).ToList();

            var listBorder = new Border
            {
                MaxHeight = 230, CornerRadius = new CornerRadius(8), Padding = new Thickness(6), Margin = new Thickness(0, 0, 0, 8),
                Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1)
            };
            var listScroll = new ScrollViewer { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
            var listPanel = new StackPanel();
            foreach (var b in filtered)
            {
                bool picked = _gdBranchSelection.TryGetValue(b.Name, out var v) ? v : b.Merged;
                var rowGrid = new Grid { Margin = new Thickness(6, 3, 6, 3) };
                var rowStack = new StackPanel { Orientation = Orientation.Horizontal };
                rowStack.Children.Add(new Border
                {
                    Width = 12, Height = 12, CornerRadius = new CornerRadius(3), Margin = new Thickness(0, 0, 8, 0),
                    Background = picked ? (Brush)FindResource("Brush.Epic.AppCore") : Brushes.Transparent,
                    BorderBrush = picked ? (Brush)FindResource("Brush.Epic.AppCore") : (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1)
                });
                rowStack.Children.Add(new TextBlock
                {
                    Text = b.Name, MaxWidth = 220, TextTrimming = TextTrimming.CharacterEllipsis,
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
                    Foreground = b.Merged ? (Brush)FindResource("Brush.Text.Muted") : new SolidColorBrush(Color.FromRgb(0xF0, 0xC9, 0xC2))
                });
                rowStack.Children.Add(new TextBlock { Text = $"{b.AgeDays}d", MinWidth = 42, TextAlignment = TextAlignment.Right, FontSize = 9, Foreground = (Brush)FindResource("Brush.Text.Dim") });
                rowStack.Children.Add(new Border
                {
                    CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1), Margin = new Thickness(6, 0, 0, 0),
                    Background = new SolidColorBrush(((SolidColorBrush)(b.Merged ? FindResource("Brush.Status.Running") : FindResource("Brush.Epic.Gate"))).Color) { Opacity = 0.14 },
                    Child = new TextBlock { Text = b.Merged ? "merged" : $"{b.Ahead} unmerged", FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = b.Merged ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Epic.Gate") }
                });
                if (b.RemoteGone || b.InWorktree)
                    rowStack.Children.Add(new TextBlock { Text = b.RemoteGone ? "remote gone" : "in a worktree", Margin = new Thickness(6, 0, 0, 0), FontSize = 8.5, Foreground = new SolidColorBrush(Color.FromRgb(0xA3, 0x74, 0xEA)) });
                rowGrid.Children.Add(rowStack);
                rowGrid.Cursor = Cursors.Hand;
                rowGrid.Background = Brushes.Transparent;
                var capturedName = b.Name;
                rowGrid.MouseLeftButtonDown += (s, e) => { _gdBranchSelection[capturedName] = !picked; RenderGitDoctorDetail(); };
                listPanel.Children.Add(rowGrid);
            }
            listScroll.Content = listPanel;
            listBorder.Child = listScroll;
            GitDoctorDetailPanel.Children.Add(listBorder);

            int pickedCount = _gdBranches.Count(b => _gdBranchSelection.TryGetValue(b.Name, out var v) ? v : b.Merged);
            var actionRow = new WrapPanel { Margin = new Thickness(0, 0, 0, 16) };
            var deleteBtn = new Button
            {
                Content = $"Delete {pickedCount} selected — backup tag first", Height = 32, Padding = new Thickness(14, 0, 14, 0), Margin = new Thickness(0, 0, 6, 6),
                Background = (Brush)FindResource("Brush.Epic.AppCore"), Foreground = Brushes.Black, BorderThickness = new Thickness(0),
                FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = (double)FindResource("FontSize.11.5"), FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand
            };
            deleteBtn.Click += (s, e) => _ = DeleteSelectedBranchesAsync();
            actionRow.Children.Add(deleteBtn);
            var mergedOnlyBtn = new Button { Content = "Select merged only", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 6), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Primary"), BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1), FontSize = 11.5, Cursor = Cursors.Hand };
            mergedOnlyBtn.Click += (s, e) => { foreach (var b in _gdBranches) _gdBranchSelection[b.Name] = b.Merged; RenderGitDoctorDetail(); };
            actionRow.Children.Add(mergedOnlyBtn);
            var clearBtn = new Button { Content = "Clear", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 0, 6), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Muted"), BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1), FontSize = 11.5, Cursor = Cursors.Hand };
            clearBtn.Click += (s, e) => { foreach (var b in _gdBranches) _gdBranchSelection[b.Name] = false; RenderGitDoctorDetail(); };
            actionRow.Children.Add(clearBtn);
            GitDoctorDetailPanel.Children.Add(actionRow);
        }

        private async Task DeleteSelectedBranchesAsync()
        {
            var picked = _gdBranches.Where(b => _gdBranchSelection.TryGetValue(b.Name, out var v) ? v : b.Merged).ToList();
            if (picked.Count == 0) { ToastEngine.Show("Git Doctor", "Nothing selected.", ToastKind.Warning); return; }

            var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd-HHmmss");
            var steps = new List<GitDoctorStep> { new($"git tag backup/branches-{stamp}", $"anchor before deleting {picked.Count} branches") };
            foreach (var b in picked)
                steps.Add(new GitDoctorStep($"git branch {(b.Merged ? "-d" : "-D")} {b.Name}", b.Merged ? "merged, safe delete" : $"FORCED — {b.Ahead} unmerged commits"));
            steps.Add(new GitDoctorStep("git remote prune origin", "drop remote-tracking refs that no longer exist"));

            await RunGitDoctorStepsAsync(steps, $"Delete {picked.Count} branches", onDone: null);
            _gdBranchSelection.Clear();
            _gdBranches = await _gitDoctorService.ComputeBranchesAsync();
            RenderGitDoctorDetail();
        }

        private void RenderGitDoctorLookupResult(GitDoctorCommitInfo hit)
        {
            var top = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 9) };
            top.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(4), Padding = new Thickness(7, 3, 7, 3), Margin = new Thickness(0, 0, 9, 0),
                Background = new SolidColorBrush(((SolidColorBrush)(hit.Reachable ? FindResource("Brush.Status.Running") : FindResource("Brush.Epic.Gate"))).Color) { Opacity = 0.16 },
                Child = new TextBlock { Text = hit.Reachable ? "REACHABLE" : "UNREACHABLE", FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = hit.Reachable ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Epic.Gate") }
            });
            top.Children.Add(new TextBlock { Text = hit.Sha[..Math.Min(9, hit.Sha.Length)], FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 15, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Heading") });
            GitDoctorDetailPanel.Children.Add(top);
            GitDoctorDetailPanel.Children.Add(new TextBlock { Text = hit.Subject, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 9), FontSize = 12.5, Foreground = (Brush)FindResource("Brush.Text.Primary") });
            GitDoctorDetailPanel.Children.Add(new Border
            {
                Padding = new Thickness(10, 9, 10, 9), CornerRadius = new CornerRadius(7), Margin = new Thickness(0, 0, 0, 11),
                Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1),
                Child = new TextBlock
                {
                    Text = $"commit {hit.Sha}\nAuthor: {hit.Author}\nDate:   {hit.When}\nFound in: {hit.Where}\n{hit.Stat}",
                    TextWrapping = TextWrapping.Wrap,
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5, Foreground = (Brush)FindResource("Brush.Text.Muted")
                }
            });
            GitDoctorDetailPanel.Children.Add(GdLabel("FILES"));
            foreach (var f in hit.Files.Take(20))
                GitDoctorDetailPanel.Children.Add(new TextBlock { Text = f, TextWrapping = TextWrapping.Wrap, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5, Margin = new Thickness(0, 0, 0, 1), Foreground = new SolidColorBrush(Color.FromRgb(0x7D, 0xC4, 0xF5)) });
            GitDoctorDetailPanel.Children.Add(new Border
            {
                Padding = new Thickness(9, 8, 9, 8), CornerRadius = new CornerRadius(7), Margin = new Thickness(0, 11, 0, 12),
                Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Epic.AppCore")).Color) { Opacity = 0.07 },
                BorderBrush = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Epic.AppCore")).Color) { Opacity = 0.28 }, BorderThickness = new Thickness(1),
                Child = new TextBlock { Text = hit.Notes, TextWrapping = TextWrapping.Wrap, FontSize = 12, Foreground = new SolidColorBrush(Color.FromRgb(0xE6, 0xC9, 0x8D)) }
            });

            var actions = new WrapPanel { Margin = new Thickness(0, 0, 0, 18) };
            var branchBtn = new Button { Content = "Save it on a branch", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 6), Background = (Brush)FindResource("Brush.Status.Running"), Foreground = Brushes.Black, BorderThickness = new Thickness(0), FontSize = 11.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand };
            branchBtn.Click += (s, e) => _ = RunGitDoctorStepsAsync(new[] { new GitDoctorStep($"git branch recover/{hit.Sha[..Math.Min(7, hit.Sha.Length)]} {hit.Sha[..Math.Min(9, hit.Sha.Length)]}", "make the commit reachable so it cannot be garbage collected") }, $"Save {hit.Sha[..Math.Min(9, hit.Sha.Length)]} on a branch", null);
            actions.Children.Add(branchBtn);
            var cherryBtn = new Button { Content = "Cherry-pick here", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 6), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Primary"), BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1), FontSize = 11.5, Cursor = Cursors.Hand };
            cherryBtn.Click += (s, e) => _ = RunGitDoctorStepsAsync(new[] { new GitDoctorStep($"git cherry-pick {hit.Sha[..Math.Min(9, hit.Sha.Length)]}", "replay it onto the branch you are on") }, $"Cherry-pick {hit.Sha[..Math.Min(9, hit.Sha.Length)]}", null);
            actions.Children.Add(cherryBtn);
            var showBtn = new Button { Content = "Copy git show", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 6, 6), Background = Brushes.Transparent, Foreground = (Brush)FindResource("Brush.Text.Primary"), BorderBrush = (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1), FontSize = 11.5, Cursor = Cursors.Hand };
            showBtn.Click += (s, e) => { Clipboard.SetText($"git show {hit.Sha[..Math.Min(9, hit.Sha.Length)]} --stat"); ToastEngine.Show("Git Doctor", "Copied git show command.", ToastKind.Info); };
            actions.Children.Add(showBtn);
            var askBtn = new Button { Content = "Ask Claude", Height = 32, Padding = new Thickness(12, 0, 12, 0), Margin = new Thickness(0, 0, 0, 6), Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Claude.Accent")).Color) { Opacity = 0.13 }, Foreground = (Brush)FindResource("Brush.Claude.Accent"), BorderBrush = (Brush)FindResource("Brush.Claude.Accent"), BorderThickness = new Thickness(1), FontSize = 11.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand };
            askBtn.Click += (s, e) =>
            {
                var md = $"**Git Doctor — commit {hit.Sha[..Math.Min(9, hit.Sha.Length)]}**\n\n```\ncommit {hit.Sha}\nAuthor: {hit.Author}\nDate:   {hit.When}\n\n    {hit.Subject}\n\n{hit.Stat}\n```\n{hit.Notes}";
                Clipboard.SetText(md);
                ToastEngine.Show("Git Doctor", "Commit details copied — paste into the chat.", ToastKind.Info);
            };
            actions.Children.Add(askBtn);
            GitDoctorDetailPanel.Children.Add(actions);
        }

        private void RenderGitDoctorLookupNotFound()
        {
            var top = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 9) };
            top.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(4), Padding = new Thickness(7, 3, 7, 3), Margin = new Thickness(0, 0, 9, 0),
                Background = new SolidColorBrush(((SolidColorBrush)FindResource("Brush.Epic.AppCore")).Color) { Opacity = 0.16 },
                Child = new TextBlock { Text = "NOT FOUND", FontSize = 8.5, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Epic.AppCore") }
            });
            top.Children.Add(new TextBlock { Text = _gdLookupQueryShown, FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 15, FontWeight = (FontWeight)FindResource("FontWeight.ExtraBold"), Foreground = (Brush)FindResource("Brush.Text.Heading") });
            GitDoctorDetailPanel.Children.Add(top);
            GitDoctorDetailPanel.Children.Add(new TextBlock
            {
                Text = "No object starting with that text was found in this repository or any of its worktrees. It may live on a remote you have not fetched, or in a worktree that was deleted.",
                TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12), FontSize = 12.5, Foreground = (Brush)FindResource("Brush.Text.Primary")
            });
            var huntBtn = new Button { Content = "Hunt for it everywhere", Height = 32, Padding = new Thickness(14, 0, 14, 0), Background = (Brush)FindResource("Brush.Epic.AppCore"), Foreground = Brushes.Black, BorderThickness = new Thickness(0), FontSize = 11.5, FontWeight = (FontWeight)FindResource("FontWeight.Bold"), Cursor = Cursors.Hand, HorizontalAlignment = HorizontalAlignment.Left };
            var capturedQuery = _gdLookupQueryShown;
            huntBtn.Click += (s, e) => _ = RunGitDoctorStepsAsync(new[]
            {
                new GitDoctorStep("git fetch --all --prune", "pull every remote ref"),
                new GitDoctorStep($"git log --all --oneline | findstr {capturedQuery}", "search every branch for the object"),
                new GitDoctorStep("git fsck --lost-found", "check dangling objects too")
            }, $"Hunt for {capturedQuery}", null);
            GitDoctorDetailPanel.Children.Add(huntBtn);
        }

        private void GitDoctorQueryBox_TextChanged(object sender, TextChangedEventArgs e) => _ = GitDoctorLookupAsync(GitDoctorQueryBox.Text.Trim());

        private async Task GitDoctorLookupAsync(string query)
        {
            if (query.Length == 0)
            {
                _gdLookupResult = null;
                _gdLookupNotFound = false;
                RenderGitDoctorDetail();
                return;
            }
            _gdLookupQueryShown = query;
            var isHashLike = query.Length >= 4 && query.All(c => Uri.IsHexDigit(c));
            if (!isHashLike)
            {
                _gdLookupResult = null;
                _gdLookupNotFound = true;
                RenderGitDoctorDetail();
                return;
            }

            var hit = await _gitDoctorService.LookupCommitAsync(query);
            if (GitDoctorQueryBox.Text.Trim() != query) return; // superseded by a newer keystroke
            _gdLookupResult = hit;
            _gdLookupNotFound = hit == null;
            RenderGitDoctorDetail();
        }

        private async Task RunGitDoctorRemedyAsync(GitDoctorFinding f)
        {
            var r = RemedyFor(f);
            if (r == null) return;
            await RunGitDoctorStepsAsync(r.Steps, $"{r.Label} — {f.Title}", () =>
            {
                f.Fixed = true;
                ToastEngine.Show("Git Doctor", $"{f.Title} — fixed.", ToastKind.Success);
            });
            RenderGitDoctor();
        }

        private async Task RunGitDoctorNightmareAsync()
        {
            var open = _gdFindings.Where(f => !f.Fixed).ToList();
            if (open.Count == 0) { ToastEngine.Show("Git Doctor", "Nothing left to fix — the repo is clean.", ToastKind.Info); return; }

            var stamp = DateTime.UtcNow.ToString("HHmmss");
            var steps = new List<GitDoctorStep> { new($"git branch backup/pre-doctor-{stamp}", "safety net before anything else") };
            foreach (var f in open)
            {
                var r = RemedyFor(f);
                if (r != null) steps.AddRange(r.Steps);
            }
            steps.Add(new GitDoctorStep("git status --short --branch", "prove the tree is clean at the end"));

            await RunGitDoctorStepsAsync(steps, $"End this git nightmare — {open.Count} findings, {steps.Count} commands", () =>
            {
                foreach (var f in open) f.Fixed = true;
                ToastEngine.Show("Git Doctor", "Repo is clean. Backup branch kept in case you want the old history.", ToastKind.Success);
            });
            RenderGitDoctor();
        }

        private void BtnGitDoctorNightmare_Click(object sender, RoutedEventArgs e) => _ = RunGitDoctorNightmareAsync();

        private async Task RunGitDoctorStepsAsync(IReadOnlyList<GitDoctorStep> steps, string label, Action? onDone)
        {
            _gdRunning = true;
            _gdLog.Clear();
            _gdLog.Add((label, null, true));
            RenderGitDoctorLog();

            await foreach (var result in _gitDoctorService.RunStepsAsync(steps))
            {
                _gdLog.Add((result.Success ? result.Cmd : $"{result.Cmd}  (failed)", result.Why, false));
                RenderGitDoctorLog();
            }

            _gdRunning = false;
            _gdLog.Add(($"Finished — {steps.Count} command{(steps.Count == 1 ? "" : "s")}.", null, false));
            RenderGitDoctorLog();
            onDone?.Invoke();
        }

        private void RenderGitDoctorLog()
        {
            GitDoctorRunningLabel.Visibility = _gdRunning ? Visibility.Visible : Visibility.Collapsed;
            RenderGitDoctorLog(GitDoctorLogPanel);
        }

        private void RenderGitDoctorLog(StackPanel target)
        {
            target.Children.Clear();
            if (_gdLog.Count == 0)
            {
                target.Children.Add(new TextBlock
                {
                    Text = "Every command the doctor runs shows up here with the reason it ran, so you can paste the whole session into a chat if something still goes wrong.",
                    TextWrapping = TextWrapping.Wrap, FontStyle = FontStyles.Italic,
                    FontFamily = (FontFamily)FindResource("FontFamily.Sans"), FontSize = 10, Foreground = (Brush)FindResource("Brush.Text.Dim")
                });
                return;
            }
            foreach (var (text, why, isHead) in _gdLog)
            {
                var row = new StackPanel { Margin = new Thickness(0, 0, 0, 4) };
                row.Children.Add(new TextBlock
                {
                    Text = text, TextWrapping = TextWrapping.Wrap,
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
                    Foreground = isHead ? (Brush)FindResource("Brush.Text.Heading") : (Brush)FindResource("Brush.Status.Running")
                });
                if (why != null)
                    row.Children.Add(new TextBlock { Text = why, TextWrapping = TextWrapping.Wrap, FontSize = 9, Foreground = (Brush)FindResource("Brush.Text.Dim") });
                target.Children.Add(row);
            }
        }

        private void AskClaudeAboutFinding(GitDoctorFinding f)
        {
            var r = RemedyFor(f);
            var md = $"**Git Doctor — {f.Title}** ({f.Where})\n\n```\n{f.RawGitOutput}\n```\n\nProposed remedy: {r?.Label} ({r?.Risk})\n```bash\n{string.Join("\n", r?.Steps.Select(s => s.Cmd) ?? Array.Empty<string>())}\n```\nIs this the right call, or is there something safer?";
            Clipboard.SetText(md);
            ToastEngine.Show("Git Doctor", "Finding and proposed fix copied — paste into the chat.", ToastKind.Info);
        }

        private void CopyFindingPlanJson(GitDoctorFinding f)
        {
            var r = RemedyFor(f);
            if (r == null) return;
            var plan = new { check = f.CheckId, severity = f.Severity.ToString().ToLowerInvariant(), remedy = r.Id, risk = r.Risk.ToString().ToLowerInvariant(), steps = r.Steps.Select(s => s.Cmd).ToArray() };
            Clipboard.SetText(JsonSerializer.Serialize(plan, new JsonSerializerOptions { WriteIndented = true }));
            ToastEngine.Show("Git Doctor", "Plan JSON copied.", ToastKind.Info);
        }

        private void GitDoctorSendAll_Click(object sender, MouseButtonEventArgs e)
        {
            var open = _gdFindings.Where(f => !f.Fixed).ToList();
            if (open.Count == 0) { ToastEngine.Show("Git Doctor", "No open findings to send.", ToastKind.Info); return; }
            var repoName = _gdRepoStatus?.Repo ?? "";
            var md = $"**Git Doctor — {open.Count} open findings on {repoName}**\n\n" +
                string.Join("\n", open.Select(f => $"- {f.Title} ({f.Severity}, {f.Where})\n```\n{f.RawGitOutput}\n```"));
            Clipboard.SetText(md);
            ToastEngine.Show("Git Doctor", "All open findings copied — paste into the chat.", ToastKind.Info);
        }

        private void BtnGitDoctorExtract_Click(object sender, RoutedEventArgs e) => ExtractGitDoctorPlanFrom(GitDoctorInboundBox.Text ?? "");

        private void ExtractGitDoctorPlanFrom(string raw)
        {
            var lines = raw.Split('\n')
                .Select(l => System.Text.RegularExpressions.Regex.Replace(l, @"^\s*[$>#]\s*", "").Trim())
                .Where(l => l.Length > 0 && !l.StartsWith("```") && System.Text.RegularExpressions.Regex.IsMatch(l, @"^(git|del|cmdkey|ssh|rm)\b"))
                .ToList();

            if (lines.Count == 0)
            {
                ToastEngine.Show("Git Doctor", "No runnable commands found in that paste.", ToastKind.Warning);
                return;
            }

            _gdPlan = lines.Select(l => (l, true)).ToList();
            RenderGitDoctorPlan();
        }

        private void RenderGitDoctorPlan()
        {
            BtnGitDoctorRunPlan.Visibility = _gdPlan.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            RenderGitDoctorPlan(GitDoctorPlanPanel);
            GitDoctorRunPlanLabel.Text = $"Run {_gdPlan.Count(p => p.Approved)} approved";
        }

        private void RenderGitDoctorPlan(StackPanel target)
        {
            target.Children.Clear();
            if (_gdPlan.Count == 0) return;

            var box = new Border
            {
                Padding = new Thickness(7, 6, 7, 6), CornerRadius = new CornerRadius(6),
                Background = (Brush)FindResource("Brush.Bg.Window"), BorderBrush = (Brush)FindResource("Brush.Border.Card"), BorderThickness = new Thickness(1)
            };
            var stack = new StackPanel();
            for (int i = 0; i < _gdPlan.Count; i++)
            {
                var (cmd, approved) = _gdPlan[i];
                var row = new StackPanel { Orientation = Orientation.Horizontal, Cursor = Cursors.Hand, Margin = new Thickness(0, 1, 0, 1) };
                row.Children.Add(new Border
                {
                    Width = 12, Height = 12, Margin = new Thickness(0, 2, 7, 0), CornerRadius = new CornerRadius(3),
                    Background = approved ? (Brush)FindResource("Brush.Status.Running") : Brushes.Transparent,
                    BorderBrush = approved ? (Brush)FindResource("Brush.Status.Running") : (Brush)FindResource("Brush.Border.Strong"), BorderThickness = new Thickness(1)
                });
                row.Children.Add(new TextBlock
                {
                    Text = cmd, TextWrapping = TextWrapping.Wrap,
                    FontFamily = (FontFamily)FindResource("FontFamily.Monospace"), FontSize = 10.5,
                    Foreground = approved ? (Brush)FindResource("Brush.Text.Primary") : (Brush)FindResource("Brush.Text.Dim")
                });
                int capturedIndex = i;
                row.MouseLeftButtonDown += (s, e) =>
                {
                    var (c, a) = _gdPlan[capturedIndex];
                    _gdPlan[capturedIndex] = (c, !a);
                    RenderGitDoctorPlan();
                };
                stack.Children.Add(row);
            }
            box.Child = stack;
            target.Children.Add(box);
        }

        private void BtnGitDoctorRunPlan_Click(object sender, RoutedEventArgs e) => RunGitDoctorApprovedPlan();

        private void RunGitDoctorApprovedPlan()
        {
            var approved = _gdPlan.Where(p => p.Approved).Select(p => new GitDoctorStep(p.Cmd, "from Claude")).ToList();
            if (approved.Count == 0)
            {
                ToastEngine.Show("Git Doctor", "Approve at least one command first.", ToastKind.Warning);
                return;
            }
            _ = RunGitDoctorStepsAsync(approved, $"Running Claude's plan — {approved.Count} commands", null);
        }
    }
}

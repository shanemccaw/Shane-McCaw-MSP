using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #4158 — Git Manager document tab. A brand new, narrower surface than Git
    /// Doctor's existing ActivityBar/tab panel (<see cref="GitDoctorView"/>, untouched by
    /// this issue) — one job: show what the repo needs right now as big, prominent action
    /// cards. Reuses <see cref="GitDoctorService"/>'s real detection and execution
    /// entirely (GetRepoStatusAsync / RunChecksAsync / RunStepsAsync); only the
    /// presentation is new. Refreshes on every real becoming-visible, the same
    /// self-contained convention <c>WhatsRemainingPanel</c> (Git #4149) already uses —
    /// no MainWindow-driven wire needed since this reads nothing MainWindow owns.
    /// </summary>
    public partial class GitManagerView : UserControl
    {
        private readonly GitDoctorService _gitDoctorService = new();
        private GitDoctorRepoStatus? _repoStatus;
        private IReadOnlyList<GitDoctorFinding> _findings = Array.Empty<GitDoctorFinding>();
        private bool _loading;
        private bool _running;

        public GitManagerView()
        {
            InitializeComponent();
            IsVisibleChanged += OnIsVisibleChanged;
        }

        private async void OnIsVisibleChanged(object sender, DependencyPropertyChangedEventArgs e)
        {
            if (IsVisible) await RefreshAsync();
        }

        private async void BtnGitManagerRefresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

        private async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_loading) return;
            _loading = true;
            BtnGitManagerRefresh.IsEnabled = false;
            GitManagerSubline.Text = "Checking git…";
            try
            {
                _repoStatus = await _gitDoctorService.GetRepoStatusAsync();
                _findings = await _gitDoctorService.RunChecksAsync();
                Render();
            }
            catch (Exception ex)
            {
                ActivityLog.Log("git-manager", $"Refresh failed: {ex.Message}");
                GitManagerCardsPanel.Children.Clear();
                GitManagerSubline.Text = "";
                GitManagerCardsPanel.Children.Add(BuildEmptyState(
                    "Couldn't check the repo",
                    ex.Message));
            }
            finally
            {
                _loading = false;
                BtnGitManagerRefresh.IsEnabled = true;
            }
        }

        private void Render()
        {
            var repo = _repoStatus;
            GitManagerSubline.Text = repo != null
                ? $"{repo.Repo} · {repo.Branch} · {repo.Ahead} ahead · {repo.Behind} behind"
                : "";

            GitManagerCardsPanel.Children.Clear();

            bool anyCard = false;

            if (repo != null && repo.Ahead > 0)
            {
                anyCard = true;
                GitManagerCardsPanel.Children.Add(BuildPushPullCard(
                    headline: $"You have {repo.Ahead} local commit{(repo.Ahead == 1 ? "" : "s")} waiting to be pushed",
                    subline: $"Push to {(string.IsNullOrEmpty(repo.Remote) ? "origin" : repo.Remote)} to share {(repo.Ahead == 1 ? "it" : "them")}.",
                    buttonLabel: "Push",
                    accent: (Brush)FindResource("GreenBrush"),
                    onClick: () => _ = RunSimpleGitCommandAsync("git push", "Push")));
            }

            if (repo != null && repo.Behind > 0)
            {
                anyCard = true;
                GitManagerCardsPanel.Children.Add(BuildPushPullCard(
                    headline: $"{repo.Behind} commit{(repo.Behind == 1 ? "" : "s")} waiting to be pulled",
                    subline: "Bring your local branch up to date with the remote.",
                    buttonLabel: "Pull",
                    accent: (Brush)FindResource("BlueBrush"),
                    onClick: () => _ = RunSimpleGitCommandAsync("git pull", "Pull")));
            }

            foreach (var finding in _findings)
            {
                if (finding.Fixed) continue;
                anyCard = true;
                GitManagerCardsPanel.Children.Add(BuildFindingCard(finding));
            }

            if (!anyCard)
            {
                GitManagerCardsPanel.Children.Add(BuildEmptyState(
                    "No local changes",
                    repo != null
                        ? $"{repo.Repo} on {repo.Branch} is clean and up to date with the remote. Nothing needs your attention right now."
                        : "Nothing needs your attention right now."));
            }
        }

        private Border BuildEmptyState(string headline, string subline)
        {
            var stack = new StackPanel { Margin = new Thickness(0, 40, 0, 0), HorizontalAlignment = HorizontalAlignment.Center };
            stack.Children.Add(new TextBlock
            {
                Text = headline, FontSize = 18, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center,
                Foreground = (Brush)FindResource("TextBrush")
            });
            stack.Children.Add(new TextBlock
            {
                Text = subline, FontSize = 12.5, Margin = new Thickness(0, 8, 0, 0), TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center, MaxWidth = 460, HorizontalAlignment = HorizontalAlignment.Center,
                Foreground = (Brush)FindResource("OverlayBrush")
            });
            return new Border { Child = stack, HorizontalAlignment = HorizontalAlignment.Stretch };
        }

        /// <summary>GitHub-Desktop-weight card: bold headline + explanation on the left,
        /// one big one-click button on the right.</summary>
        private Border BuildActionCard(string headline, string subline, Brush accent, IEnumerable<(string Label, Brush? Foreground, Brush? Border, RoutedEventHandler OnClick, bool Primary)> buttons)
        {
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var textStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 20, 0) };
            textStack.Children.Add(new TextBlock
            {
                Text = headline, FontSize = 15, FontWeight = FontWeights.Bold, TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("TextBrush")
            });
            textStack.Children.Add(new TextBlock
            {
                Text = subline, FontSize = 11.5, Margin = new Thickness(0, 5, 0, 0), TextWrapping = TextWrapping.Wrap,
                Foreground = (Brush)FindResource("Subtext1Brush")
            });
            Grid.SetColumn(textStack, 0);
            grid.Children.Add(textStack);

            var buttonStack = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            foreach (var (label, fg, border, onClick, primary) in buttons)
            {
                var btn = new Button
                {
                    Content = label,
                    Height = primary ? 40 : 32,
                    Padding = new Thickness(primary ? 20 : 14, 0, primary ? 20 : 14, 0),
                    Margin = new Thickness(8, 0, 0, 0),
                    Cursor = Cursors.Hand,
                    FontSize = primary ? 13 : 11,
                    FontWeight = primary ? FontWeights.Bold : FontWeights.SemiBold,
                    BorderThickness = new Thickness(primary ? 0 : 1),
                };
                if (primary)
                {
                    btn.Background = accent;
                    btn.Foreground = Brushes.Black;
                }
                else
                {
                    btn.Background = Brushes.Transparent;
                    btn.Foreground = fg ?? (Brush)FindResource("Subtext1Brush");
                    btn.BorderBrush = border ?? (Brush)FindResource("Surface1Brush");
                }
                btn.Click += onClick;
                buttonStack.Children.Add(btn);
            }
            Grid.SetColumn(buttonStack, 1);
            grid.Children.Add(buttonStack);

            return new Border
            {
                Padding = new Thickness(22, 18, 22, 18),
                Margin = new Thickness(0, 0, 0, 14),
                CornerRadius = new CornerRadius(10),
                Background = (Brush)FindResource("Surface0Brush"),
                BorderBrush = new SolidColorBrush(((SolidColorBrush)accent).Color) { Opacity = 0.35 },
                BorderThickness = new Thickness(1),
                Child = grid
            };
        }

        private Border BuildPushPullCard(string headline, string subline, string buttonLabel, Brush accent, Action onClick)
        {
            return BuildActionCard(headline, subline, accent, new[]
            {
                (buttonLabel, (Brush?)null, (Brush?)null, (RoutedEventHandler)((s, e) => onClick()), true)
            });
        }

        private Border BuildFindingCard(GitDoctorFinding finding)
        {
            var recommended = finding.Remedies.FirstOrDefault(r => r.Recommended) ?? finding.Remedies.FirstOrDefault();
            var accent = finding.Severity switch
            {
                GitDoctorSeverity.Low => (Brush)FindResource("Subtext1Brush"),
                GitDoctorSeverity.Medium => (Brush)FindResource("BlueBrush"),
                _ => (Brush)FindResource("StatusErrorBrush")
            };

            var buttons = new List<(string, Brush?, Brush?, RoutedEventHandler, bool)>();
            if (recommended != null)
            {
                buttons.Add((recommended.Label, null, null, (s, e) => _ = RunFindingRemedyAsync(finding, recommended), true));
            }
            // Other remedies stay visually secondary — smaller, outline buttons, not equal-weight
            // with the primary recommended fix. Filtered by Id, not reference/value equality —
            // GitDoctorRemedy is a record, so a bare "!= recommended" would also drop any other
            // remedy that happened to be structurally identical.
            foreach (var other in finding.Remedies.Where(r => r.Id != recommended?.Id))
            {
                buttons.Add((other.Label, (Brush)FindResource("Subtext1Brush"), (Brush)FindResource("Surface1Brush"),
                    (s, e) => _ = RunFindingRemedyAsync(finding, other), false));
            }

            var subline = string.IsNullOrEmpty(finding.Where) ? finding.PlainEnglish : $"{finding.PlainEnglish} ({finding.Where})";
            return BuildActionCard(finding.Title, subline, accent, buttons);
        }

        private async System.Threading.Tasks.Task RunSimpleGitCommandAsync(string cmd, string label)
        {
            if (_running) return;
            _running = true;
            try
            {
                var steps = new[] { new GitDoctorStep(cmd, label) };
                bool ok = true;
                string lastOutput = "";
                await foreach (var result in _gitDoctorService.RunStepsAsync(steps))
                {
                    ok = ok && result.Success;
                    lastOutput = result.Output;
                }
                ToastEngine.Show("Git Manager", ok ? $"{label} succeeded." : $"{label} failed — {lastOutput}", ok ? ToastKind.Success : ToastKind.Error);
            }
            finally
            {
                _running = false;
                await RefreshAsync();
            }
        }

        private async System.Threading.Tasks.Task RunFindingRemedyAsync(GitDoctorFinding finding, GitDoctorRemedy remedy)
        {
            if (_running) return;
            _running = true;
            try
            {
                bool ok = true;
                string lastOutput = "";
                await foreach (var result in _gitDoctorService.RunStepsAsync(remedy.Steps))
                {
                    ok = ok && result.Success;
                    lastOutput = result.Output;
                }
                if (ok) finding.Fixed = true;
                ToastEngine.Show("Git Manager", ok ? $"{finding.Title} — fixed." : $"{remedy.Label} failed — {lastOutput}", ok ? ToastKind.Success : ToastKind.Error);
            }
            finally
            {
                _running = false;
                await RefreshAsync();
            }
        }
    }
}

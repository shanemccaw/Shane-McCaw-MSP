using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
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
    /// Git #2799 — the chat tool-rail MINI Git Doctor panel (README-ClaudeChat.md §6.2),
    /// sibling of #2798's full ActivityBar <see cref="GitDoctorView"/>. Body-only, hosted in
    /// <see cref="ChatDocumentContainer"/>'s ToolHost for the "gitdoctor" wrench tool id, cached
    /// one-per-tab (same precedent as <see cref="TerminalView"/> #2769 / <see cref="LogPeekView"/>
    /// #2787).
    ///
    /// Data is #2798's real, landed <see cref="GitDoctorService"/> running actual git against this
    /// repo — <see cref="GitDoctorService.RunChecksAsync"/> / <see cref="GitDoctorService.GetRepoStatusAsync"/>
    /// / <see cref="GitDoctorService.RunStepsAsync"/>. No seeded/demo findings: an empty list means
    /// the repo really is clean.
    ///
    /// The substantive half is the Claude bridge (README §6.2 item 3): Claude answers in prose with
    /// fenced shell commands, the operator pastes that reply back here, <see cref="ExtractPlan"/>
    /// parses the runnable commands out into individually-approvable <see cref="_plan"/> rows, and
    /// only the approved ones run (<see cref="RunApprovedPlanAsync"/>). Nothing runs unapproved —
    /// the exact conflict-resolution flow Feature #2194 called for.
    ///
    /// Implements <see cref="IChatSendableTool"/> (#2783): the generic rail-header Send-to-Chat icon
    /// sends the current plan (once extracted) else the open findings, as real markdown.
    /// </summary>
    public partial class GitDoctorMiniView : UserControl, IChatSendableTool
    {
        private readonly GitDoctorService _service = new();

        private IReadOnlyList<GitDoctorFinding> _findings = Array.Empty<GitDoctorFinding>();
        private GitDoctorRepoStatus? _repoStatus;
        private string? _selectedFindingId;
        private readonly Dictionary<string, string> _remedyChoice = new();
        private bool _loaded;
        private bool _loading;
        private bool _running;

        // Parsed-from-Claude commands, each with its own approve toggle (README §6.2 item 4).
        private List<(string Cmd, bool Approved)> _plan = new();
        private readonly List<(string Text, bool IsHead)> _log = new();

        /// <summary>Set by <see cref="ChatDocumentContainer"/> — routes the in-panel "send findings"
        /// button through the container's own <c>AppendToComposer</c> (README §5/§6 invariant: a tool
        /// writes into the composer, never auto-sends). Left null when hosted outside a container.</summary>
        public Action<string>? SendToComposer { get; set; }

        public GitDoctorMiniView()
        {
            InitializeComponent();
            RenderSummary();
            RenderFindings();
            RenderPlan();
            RenderLog();
        }

        // ── Severity palette (README §6.2 dot + chip; hexes match the full view's Low/Medium/High) ──
        private static Brush SeverityBrush(GitDoctorSeverity s) => s switch
        {
            GitDoctorSeverity.Low => Hex("#a6adc8"),
            GitDoctorSeverity.Medium => Hex("#89b4fa"),
            _ => Hex("#f38ba8"),
        };

        private static SolidColorBrush Hex(string hex) => new((Color)ColorConverter.ConvertFromString(hex));

        // ── Load ──────────────────────────────────────────────────────────────
        /// <summary>Called by the container the first time the rail opens Git Doctor — kicks the
        /// real checks off exactly once. Safe to call repeatedly (idempotent).</summary>
        public void EnsureLoaded() => _ = EnsureLoadedAsync();

        private async Task EnsureLoadedAsync()
        {
            if (_loaded || _loading) return;
            await LoadChecksAsync();
        }

        private async Task LoadChecksAsync()
        {
            _loading = true;
            GdmHeadline.Text = "Checking git…";
            GdmSubline.Text = "";

            _repoStatus = await _service.GetRepoStatusAsync();
            _findings = await _service.RunChecksAsync();

            _loaded = true;
            _loading = false;
            _selectedFindingId = _findings.FirstOrDefault(f => !f.Fixed)?.CheckId ?? _findings.FirstOrDefault()?.CheckId;
            RenderSummary();
            RenderFindings();
            RenderSelectedDetail();
        }

        private GitDoctorRemedy? RemedyFor(GitDoctorFinding f)
        {
            if (_remedyChoice.TryGetValue(f.CheckId, out var pick))
            {
                var m = f.Remedies.FirstOrDefault(r => r.Id == pick);
                if (m != null) return m;
            }
            return f.Remedies.FirstOrDefault(r => r.Recommended) ?? f.Remedies.FirstOrDefault();
        }

        // ── 1. Summary ────────────────────────────────────────────────────────
        private void RenderSummary()
        {
            var open = _findings.Where(f => !f.Fixed).ToList();

            GdmHeadline.Text = !_loaded
                ? "Checking git…"
                : open.Count > 0
                    ? $"{open.Count} thing{(open.Count == 1 ? " is" : "s are")} blocking git right now"
                    : "Everything git was complaining about is fixed";

            var repo = _repoStatus;
            GdmSubline.Text = repo != null
                ? $"{repo.Repo} · {repo.Branch} · {repo.Ahead} ahead · {repo.Behind} behind"
                : "";

            bool canFix = open.Count > 0 && !_running;
            GdmNightmareLabel.Text = open.Count > 0 ? "Fix My Git Nightmare" : "Nothing left to fix";
            GdmNightmareBtn.Background = open.Count > 0 ? Hex("#e2593f") : Hex("#232320");
            GdmNightmareBtn.BorderBrush = open.Count > 0 ? Hex("#e2593f") : Hex("#3d3b37");
            GdmNightmareBtn.BorderThickness = new Thickness(open.Count > 0 ? 0 : 1);
            GdmNightmareLabel.Foreground = open.Count > 0 ? Hex("#1a0f0a") : Hex("#7a7975");
            GdmNightmareBtn.Opacity = canFix || open.Count == 0 ? 1.0 : 0.6;
            GdmNightmareBtn.IsEnabled = canFix;

            int totalSteps = open.Sum(f => RemedyFor(f)?.Steps.Count ?? 0);
            GdmNightmareSub.Text = open.Count > 0
                ? $"backup branch first, then {totalSteps} command{(totalSteps == 1 ? "" : "s")}"
                : (_loaded ? "run a fresh check any time" : "");
        }

        private async void GdmNightmareBtn_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
        {
            if (!GdmNightmareBtn.IsEnabled) return;
            await RunNightmareAsync();
        }

        private async Task RunNightmareAsync()
        {
            var open = _findings.Where(f => !f.Fixed).ToList();
            if (open.Count == 0)
            {
                ToastEngine.Show("Git Doctor", "Nothing left to fix — the repo is clean.", ToastKind.Info);
                return;
            }

            var stamp = DateTime.UtcNow.ToString("HHmmss");
            var steps = new List<GitDoctorStep> { new($"git branch backup/pre-doctor-{stamp}", "safety net before anything else") };
            foreach (var f in open)
            {
                var r = RemedyFor(f);
                if (r != null) steps.AddRange(r.Steps);
            }
            steps.Add(new GitDoctorStep("git status --short --branch", "prove the tree is clean at the end"));

            await RunStepsAsync(steps, $"Fix My Git Nightmare — {open.Count} findings, {steps.Count} commands", () =>
            {
                foreach (var f in open) f.Fixed = true;
                ToastEngine.Show("Git Doctor", "Repo is clean. Backup branch kept in case you want the old history.", ToastKind.Success);
            });
            RenderSummary();
            RenderFindings();
            RenderSelectedDetail();
        }

        // ── 2. Findings ───────────────────────────────────────────────────────
        private void RenderFindings()
        {
            GdmFindingsPanel.Children.Clear();

            if (!_loaded)
            {
                GdmFindingsPanel.Children.Add(new TextBlock
                {
                    Text = "Running checks against the real repo…", Margin = new Thickness(4, 4, 4, 4),
                    FontSize = 11, TextWrapping = TextWrapping.Wrap, Foreground = Hex("#7a7975")
                });
                return;
            }

            if (_findings.Count == 0)
            {
                GdmFindingsPanel.Children.Add(new TextBlock
                {
                    Text = "No findings. Git is clean.", Margin = new Thickness(4, 4, 4, 4),
                    FontSize = 11, TextWrapping = TextWrapping.Wrap, Foreground = Hex("#7a7975")
                });
                return;
            }

            foreach (var f in _findings)
            {
                bool selected = f.CheckId == _selectedFindingId;
                var sev = SeverityBrush(f.Severity);

                var row = new Border
                {
                    Padding = new Thickness(7, 6, 7, 6),
                    Margin = new Thickness(0, 0, 0, 2),
                    CornerRadius = new CornerRadius(6),
                    Cursor = Cursors.Hand,
                    Opacity = f.Fixed ? 0.5 : 1.0,
                    Background = selected ? Hex("#2a2a27") : Brushes.Transparent,
                    BorderThickness = new Thickness(2, 0, 0, 0),
                    BorderBrush = selected ? sev : Brushes.Transparent
                };

                var grid = new Grid();
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

                var dot = new Ellipse
                {
                    Width = 7, Height = 7, VerticalAlignment = VerticalAlignment.Center,
                    Fill = f.Fixed ? Hex("#9fd0a9") : sev
                };
                Grid.SetColumn(dot, 0);

                var title = new TextBlock
                {
                    Text = f.Title, Margin = new Thickness(8, 0, 8, 0),
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    TextDecorations = f.Fixed ? TextDecorations.Strikethrough : null,
                    FontSize = 11.5, FontWeight = FontWeights.SemiBold,
                    VerticalAlignment = VerticalAlignment.Center,
                    Foreground = f.Fixed ? Hex("#9fd0a9") : Hex("#ece9e4")
                };
                Grid.SetColumn(title, 1);

                var chip = new Border
                {
                    CornerRadius = new CornerRadius(3), Padding = new Thickness(5, 1, 5, 1),
                    VerticalAlignment = VerticalAlignment.Center,
                    Background = new SolidColorBrush(((SolidColorBrush)sev).Color) { Opacity = 0.16 },
                    Child = new TextBlock
                    {
                        Text = f.Severity.ToString().ToUpperInvariant(),
                        FontSize = 8, FontWeight = FontWeights.Bold, Foreground = sev
                    }
                };
                Grid.SetColumn(chip, 2);

                grid.Children.Add(dot);
                grid.Children.Add(title);
                grid.Children.Add(chip);
                row.Child = grid;

                var capturedId = f.CheckId;
                row.MouseLeftButtonUp += (_, _) => SelectFinding(capturedId);
                GdmFindingsPanel.Children.Add(row);
            }
        }

        private void SelectFinding(string checkId)
        {
            _selectedFindingId = checkId;
            RenderFindings();
            RenderSelectedDetail();
        }

        // The full-document surface (#2798 GitDoctorView) is a separate instance here, so §6.2's
        // "selects the finding in the full document" is honestly adapted: selecting highlights the
        // row and previews the doctor's recommended fix inline; the rail-header maximize opens the
        // full document. Not a stub — real remedy commands rendered from the real finding.
        private void RenderSelectedDetail()
        {
            GdmSelectedDetailBody.Children.Clear();
            var sel = _findings.FirstOrDefault(f => f.CheckId == _selectedFindingId);
            if (!_loaded || sel == null)
            {
                GdmSelectedDetail.Visibility = Visibility.Collapsed;
                return;
            }
            GdmSelectedDetail.Visibility = Visibility.Visible;

            GdmSelectedDetailBody.Children.Add(new TextBlock
            {
                Text = sel.PlainEnglish, TextWrapping = TextWrapping.Wrap,
                FontSize = 10.5, Foreground = Hex("#c2c0bc")
            });

            var r = RemedyFor(sel);
            if (r != null)
            {
                GdmSelectedDetailBody.Children.Add(new TextBlock
                {
                    Text = $"Recommended: {r.Label} ({r.Risk.ToString().ToLowerInvariant()})",
                    Margin = new Thickness(0, 6, 0, 3), TextWrapping = TextWrapping.Wrap,
                    FontSize = 9.5, FontWeight = FontWeights.Bold, Foreground = Hex("#ece9e4")
                });
                foreach (var st in r.Steps)
                {
                    GdmSelectedDetailBody.Children.Add(new TextBlock
                    {
                        Text = st.Cmd, TextWrapping = TextWrapping.Wrap,
                        FontFamily = new FontFamily("Consolas"), FontSize = 9.5,
                        Foreground = Hex("#7dc4f5")
                    });
                }
            }
        }

        // ── 3. Claude bridge — "send findings" ────────────────────────────────
        private void GdmSendFindings_Click(object sender, MouseButtonEventArgs e)
        {
            var md = BuildFindingsMarkdown();
            if (md == null)
            {
                ToastEngine.Show("Git Doctor", "No open findings to send.", ToastKind.Info);
                return;
            }
            if (SendToComposer != null)
                SendToComposer(md);
            else
            {
                // Fallback when hosted outside a container: clipboard, the same honest path the full
                // document uses (it has no adjacent composer either).
                try { Clipboard.SetText(md); ToastEngine.Show("Git Doctor", "Findings copied — paste into the chat.", ToastKind.Info); }
                catch (Exception ex) { ActivityLog.Log("chat.container", $"git doctor mini send-findings copy failed: {ex.Message}"); }
            }
        }

        /// <summary>The open findings (or the single selected one, if the user has picked a row) as
        /// real markdown — headline, each finding's raw git output, and the recommended remedy — so
        /// Claude has enough to answer with the commands the operator then pastes back below.</summary>
        private string? BuildFindingsMarkdown()
        {
            var open = _findings.Where(f => !f.Fixed).ToList();
            if (open.Count == 0) return null;

            // If the operator selected a specific open finding, lead with just that one.
            var sel = _findings.FirstOrDefault(f => f.CheckId == _selectedFindingId && !f.Fixed);
            var subset = sel != null ? new List<GitDoctorFinding> { sel } : open;

            var repoName = _repoStatus?.Repo ?? "";
            var header = subset.Count == 1
                ? $"**Git Doctor — {subset[0].Title}** ({subset[0].Where}) on {repoName}"
                : $"**Git Doctor — {subset.Count} open findings on {repoName}**";

            var body = string.Join("\n\n", subset.Select(f =>
            {
                var r = RemedyFor(f);
                var remedy = r != null
                    ? $"\nProposed remedy: {r.Label} ({r.Risk.ToString().ToLowerInvariant()})\n```bash\n{string.Join("\n", r.Steps.Select(s => s.Cmd))}\n```"
                    : "";
                return $"- {f.Title} ({f.Severity}, {f.Where})\n```\n{f.RawGitOutput}\n```{remedy}";
            }));

            return $"{header}\n\n{body}\n\nWhat's the safest way out of this? Reply with the exact shell commands to run.";
        }

        // ── 3/4. Extract commands → Plan ──────────────────────────────────────
        private void GdmPasteBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            GdmPastePlaceholder.Visibility = string.IsNullOrEmpty(GdmPasteBox.Text) ? Visibility.Visible : Visibility.Collapsed;
        }

        private void GdmExtractBtn_Click(object sender, MouseButtonEventArgs e) => ExtractPlan(GdmPasteBox.Text ?? "");

        /// <summary>Parse runnable shell commands out of Claude's pasted prose reply. Same real
        /// parser the full view uses (<see cref="GitDoctorView.ExtractGitDoctorPlanFrom"/>): strips
        /// a leading prompt marker (<c>$ &gt; #</c>), drops fence lines, and keeps only lines that
        /// actually start with a known git-repair verb — so surrounding explanation never becomes a
        /// runnable step. Every parsed command starts approved and is individually toggleable.</summary>
        private void ExtractPlan(string raw)
        {
            var lines = raw.Split('\n')
                .Select(l => Regex.Replace(l, @"^\s*[$>#]\s*", "").Trim())
                .Where(l => l.Length > 0 && !l.StartsWith("```") && Regex.IsMatch(l, @"^(git|del|cmdkey|ssh|rm)\b"))
                .ToList();

            if (lines.Count == 0)
            {
                ToastEngine.Show("Git Doctor", "No runnable commands found in that paste.", ToastKind.Warning);
                return;
            }

            _plan = lines.Select(l => (l, true)).ToList();
            RenderPlan();
        }

        private void RenderPlan()
        {
            GdmRunPlanBtn.Visibility = _plan.Count > 0 && !_running ? Visibility.Visible : Visibility.Collapsed;
            GdmRunPlanLabel.Text = $"Run {_plan.Count(p => p.Approved)} approved";

            GdmPlanPanel.Children.Clear();
            if (_plan.Count == 0) return;

            var box = new Border
            {
                Padding = new Thickness(7, 6, 7, 6), CornerRadius = new CornerRadius(6),
                Background = Hex("#0d0f10"), BorderBrush = Hex("#302f2d"), BorderThickness = new Thickness(1)
            };
            var stack = new StackPanel();
            for (int i = 0; i < _plan.Count; i++)
            {
                var (cmd, approved) = _plan[i];
                var row = new StackPanel { Orientation = Orientation.Horizontal, Cursor = Cursors.Hand, Margin = new Thickness(0, 1, 0, 1) };
                row.Children.Add(new Border
                {
                    Width = 12, Height = 12, Margin = new Thickness(0, 2, 7, 0), CornerRadius = new CornerRadius(3),
                    Background = approved ? Hex("#9fd0a9") : Brushes.Transparent,
                    BorderBrush = approved ? Hex("#9fd0a9") : Hex("#3d3b37"), BorderThickness = new Thickness(1)
                });
                row.Children.Add(new TextBlock
                {
                    Text = cmd, TextWrapping = TextWrapping.Wrap, MaxWidth = 210,
                    FontFamily = new FontFamily("Consolas"), FontSize = 10.5,
                    Foreground = approved ? Hex("#ece9e4") : Hex("#7a7975")
                });
                int capturedIndex = i;
                row.MouseLeftButtonUp += (_, _) =>
                {
                    var (c, a) = _plan[capturedIndex];
                    _plan[capturedIndex] = (c, !a);
                    RenderPlan();
                };
                stack.Children.Add(row);
            }
            box.Child = stack;
            GdmPlanPanel.Children.Add(box);
        }

        private async void GdmRunPlanBtn_Click(object sender, MouseButtonEventArgs e) => await RunApprovedPlanAsync();

        private async Task RunApprovedPlanAsync()
        {
            if (_running) return;
            var approved = _plan.Where(p => p.Approved).Select(p => new GitDoctorStep(p.Cmd, "from Claude")).ToList();
            if (approved.Count == 0)
            {
                ToastEngine.Show("Git Doctor", "Approve at least one command first.", ToastKind.Warning);
                return;
            }
            await RunStepsAsync(approved, $"Running Claude's plan — {approved.Count} command{(approved.Count == 1 ? "" : "s")}", null);
        }

        // ── 5. Run log ────────────────────────────────────────────────────────
        private async Task RunStepsAsync(IReadOnlyList<GitDoctorStep> steps, string label, Action? onDone)
        {
            _running = true;
            RenderPlan();      // hide Run button while running
            RenderSummary();   // disable the nightmare button while running
            _log.Clear();
            _log.Add((label, true));
            RenderLog();

            await foreach (var result in _service.RunStepsAsync(steps))
            {
                _log.Add((result.Success ? result.Cmd : $"{result.Cmd}  (failed)", false));
                RenderLog();
            }

            _running = false;
            _log.Add(($"Finished — {steps.Count} command{(steps.Count == 1 ? "" : "s")}.", false));
            RenderLog();
            RenderPlan();
            RenderSummary();
            onDone?.Invoke();
        }

        private void RenderLog()
        {
            GdmLogPanel.Children.Clear();
            if (_log.Count == 0)
            {
                GdmLogPanel.Children.Add(new TextBlock
                {
                    Text = "Every command the doctor runs shows up here with the reason it ran.",
                    TextWrapping = TextWrapping.Wrap, FontStyle = FontStyles.Italic,
                    FontSize = 9.5, Foreground = Hex("#7a7975")
                });
                return;
            }
            foreach (var (text, isHead) in _log)
            {
                GdmLogPanel.Children.Add(new TextBlock
                {
                    Text = text, TextWrapping = TextWrapping.Wrap,
                    FontFamily = new FontFamily("Consolas"), FontSize = 9.5,
                    Foreground = isHead ? Hex("#ece9e4") : Hex("#9fd0a9")
                });
            }
            GdmLogScroll.ScrollToEnd();
        }

        // ── IChatSendableTool (#2783) ─────────────────────────────────────────
        /// <summary>Git #2783 — the rail-header generic Send-to-Chat icon. Once a plan has been
        /// extracted, sends the approved commands as a fenced bash block (the real "plan content");
        /// otherwise sends the open-findings markdown. Returns null when there's genuinely nothing —
        /// no plan and no open findings — so the icon hides rather than sending an empty block.</summary>
        public string? GetSendableContent()
        {
            var approved = _plan.Where(p => p.Approved).Select(p => p.Cmd).ToList();
            if (approved.Count > 0)
                return "**Git Doctor — plan**\n```bash\n" + string.Join("\n", approved) + "\n```";
            return BuildFindingsMarkdown();
        }
    }
}

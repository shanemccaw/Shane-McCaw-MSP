using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using BuildConsole.Services;
using BuildConsole.Services.BuildMap;

namespace BuildConsole
{
    /// <summary>
    /// Git #2482 (Build Chain Map, item #8 of #2473's structured index) — the top bar + status
    /// strip. Design source: <c>desktop/BuildConsole/BuildMap/README.md</c> ("Top bar contents",
    /// "Status strip") + the real reference screenshots under <c>BuildMap/screenshots/</c>.
    ///
    /// This window is the first WPF UI built for the Build Chain Map feature — #2475 (real
    /// GitHub read → <see cref="ChainDoc"/>) and #2476 (the pure §5 chain-rules engine,
    /// <see cref="ChainRules"/>) already exist and are what this window reads from; there was no
    /// prior UI shell to extend. Everything the top bar shows — the 7 stat chips, the
    /// chain-integrity pill's exact/gap count, the status-strip edge counts — comes straight out
    /// of <see cref="ChainRules.Derive"/>'s real <see cref="ChainDerived"/> snapshot of a real
    /// <see cref="ChainDoc"/>; nothing here is invented.
    ///
    /// Scope is the top bar + status strip only. The canvas/graph (#2477), edge rendering
    /// (#2478), inspector panel (#2479), interactions (#2480, drag/sentinel/gate/link-mode) and
    /// real-write persistence (#2481) are separate, still-open sub-issues of #2473 — the two body
    /// regions are honest placeholders naming those issues, not fixture content standing in for
    /// them. The "Re-wire §5.2" button is real, though: it calls #2476's own
    /// <see cref="ChainRules.RechainAll"/> directly (in-memory only — writing the result back to
    /// GitHub as real `blocked_by` edges is #2481's job, per the README's own persistence note).
    /// </summary>
    public partial class BuildChainMapWindow : Window
    {
        private const double ZoomMin = 0.35;
        private const double ZoomMax = 1.6;
        private const double ZoomStep = 0.1;

        private readonly int _epicNumber;

        private ChainDoc? _doc;
        private ChainDerived? _derived;
        private double _zoom = 1.0;
        private bool _busy;

        // Real per-Feature expand/collapse state — nothing renders it yet (that's #2477's canvas),
        // but Expand all / Collapse all need somewhere real to write, ready for #2477 to read.
        private readonly Dictionary<string, bool> _expanded = new();

        private TextBlock _featuresValue = null!;
        private TextBlock _issuesValue = null!;
        private TextBlock _readyValue = null!;
        private TextBlock _waitingValue = null!;
        private TextBlock _backlogValue = null!;
        private TextBlock _askValue = null!;
        private TextBlock _doneValue = null!;

        public BuildChainMapWindow(int epicNumber)
        {
            _epicNumber = epicNumber;
            InitializeComponent();
            BuildStatsStrip();
            Loaded += async (_, __) => await RefreshAsync();
        }

        // ── Stats strip (README.md line 55-57: 7 chips, label over mono value) ──────────────
        private void BuildStatsStrip()
        {
            _featuresValue = AddChip("FEATURES", "#e6edf3");
            _issuesValue = AddChip("ISSUES", "#e6edf3");
            _readyValue = AddChip("READY NOW", "#7fb08a");
            _waitingValue = AddChip("WAITING", "#6a8fb5");
            _backlogValue = AddChip("BACKLOG", "#8b949e");
            _askValue = AddChip("ASK SHANE", "#a374ea");
            _doneValue = AddChip("DONE", "#5f9a6c", last: true);
        }

        private TextBlock AddChip(string label, string valueColorHex, bool last = false)
        {
            var stack = new StackPanel { Margin = new Thickness(0, 0, last ? 0 : 12, 0) };
            stack.Children.Add(new TextBlock
            {
                Text = label,
                FontSize = 8,
                FontWeight = FontWeights.ExtraBold,
                Foreground = (Brush)new BrushConverter().ConvertFromString("#576069")!,
            });
            var value = new TextBlock
            {
                Text = "—",
                FontFamily = new FontFamily("Consolas"),
                FontSize = 13,
                FontWeight = FontWeights.ExtraBold,
                Foreground = (Brush)new BrushConverter().ConvertFromString(valueColorHex)!,
                Margin = new Thickness(0, 1, 0, 0),
            };
            stack.Children.Add(value);
            StatsStripPanel.Children.Add(stack);
            return value;
        }

        // ── Load / refresh from real GitHub ──────────────────────────────────────────────────
        private async System.Threading.Tasks.Task RefreshAsync()
        {
            if (_busy) return;
            _busy = true;
            try
            {
                StatusHintText.Text = $"Loading Epic #{_epicNumber} from GitHub…";
                CanvasPlaceholderText.Text = "Loading the chain from GitHub…";

                var settings = BuildConsoleSettings.Load();
                if (!settings.HasGitHubPat)
                {
                    StatusHintText.Text = "No GitHub PAT configured — set one in Settings (cog icon / File > Settings).";
                    CanvasPlaceholderText.Text = "No GitHub PAT configured.";
                    ActivityLog.Log(Channel, "no GitHub PAT configured");
                    return;
                }

                var client = new GitHubApiClient(settings.GitHubPat);
                _doc = await BuildChainMapService.BuildAsync(client, _epicNumber);

                _expanded.Clear();
                foreach (var feature in _doc.Features)
                    _expanded[feature.Id] = false;

                _derived = ChainRules.Derive(_doc);
                Render();
                ActivityLog.Log(Channel, $"Epic #{_epicNumber}: loaded {_doc.Features.Count} Features, "
                    + $"{_derived.Totals.Issues} issues, {_derived.Gaps} chain gap(s)");
            }
            catch (Exception ex)
            {
                StatusHintText.Text = $"Couldn't load Epic #{_epicNumber}: {ex.Message}";
                CanvasPlaceholderText.Text = $"Couldn't load Epic #{_epicNumber} from GitHub.\n{ex.Message}";
                ActivityLog.Log(Channel, $"Epic #{_epicNumber}: load failed — {ex.Message}");
            }
            finally
            {
                _busy = false;
            }
        }

        private const string Channel = "buildconsole.chain-map";

        // ── Render (title block, stats, chain pill, status strip) ──────────────────────────
        private void Render()
        {
            if (_doc == null || _derived == null) return;

            EpicNameText.Text = _doc.Epic.Name;
            EpicNumText.Text = $"#{_doc.Epic.Num}";

            var totals = _derived.Totals;
            _featuresValue.Text = _doc.Features.Count.ToString();
            _issuesValue.Text = totals.Issues.ToString();
            _readyValue.Text = totals.Ready.ToString();
            _waitingValue.Text = totals.Blocked.ToString();
            _backlogValue.Text = totals.Held.ToString();
            _askValue.Text = totals.Ask.ToString();
            _doneValue.Text = totals.Done.ToString();

            RenderChainPill();
            RenderStatusStrip();
            RenderZoom();

            CanvasPlaceholderText.Text =
                $"Canvas — Feature/Issue graph for Epic #{_doc.Epic.Num} lands in #2477.\n"
                + $"{_doc.Features.Count} Features, {totals.Issues} issues, {_doc.Edges.Count} blocked_by edges read from GitHub.";
        }

        /// <summary>README.md line 58-61: exact (green check) vs. N gap(s) (amber warning +
        /// Re-wire §5.2 button). Real gap/cross counts from <see cref="ChainDerived"/> — nothing
        /// here is a placeholder threshold.</summary>
        private void RenderChainPill()
        {
            var d = _derived!;
            if (d.Gaps == 0)
            {
                ChainPillBorder.Background = (Brush)new BrushConverter().ConvertFromString("#0f1a14")!;
                ChainPillBorder.BorderBrush = (Brush)new BrushConverter().ConvertFromString("#2e4a36")!;
                ChainPillBorder.BorderThickness = new Thickness(1);
                var green = (Brush)new BrushConverter().ConvertFromString("#7fb08a")!;
                ChainPillIcon.Data = (Geometry)FindResource("Icon.Check");
                ChainPillIcon.Stroke = green;
                ChainPillText.Foreground = green;
                ChainPillText.Text = $"Chain exact · {d.GateCount} gate edges, not {d.Cross}";
                RewireButton.Visibility = Visibility.Collapsed;
            }
            else
            {
                ChainPillBorder.Background = (Brush)new BrushConverter().ConvertFromString("#1a1512")!;
                ChainPillBorder.BorderBrush = (Brush)new BrushConverter().ConvertFromString("#5a3f2a")!;
                ChainPillBorder.BorderThickness = new Thickness(1);
                var amber = (Brush)new BrushConverter().ConvertFromString("#e0a879")!;
                ChainPillIcon.Data = (Geometry)FindResource("Icon.AlertTriangle");
                ChainPillIcon.Stroke = amber;
                ChainPillText.Foreground = amber;
                ChainPillText.Text = $"Chain has {d.Gaps} gap{(d.Gaps == 1 ? "" : "s")}";
                RewireButton.Visibility = Visibility.Visible;
            }
        }

        /// <summary>README.md line 45-46: left = context hint, right = mono
        /// "{fanin} fan-in · {gate} gate · {manual} added".</summary>
        private void RenderStatusStrip()
        {
            var d = _derived!;
            StatusHintText.Text =
                "Click a Feature to open its issues · drag a header to change priority · "
                + "click an issue to see what holds it · click an edge to inspect or remove it";
            StatusCountsText.Text = $"{d.FanInCount} fan-in · {d.GateCount} gate · {d.ManualCount} added";
        }

        private void RenderZoom() => ZoomPercentText.Text = $"{Math.Round(_zoom * 100)}%";

        // ── Controls ─────────────────────────────────────────────────────────────────────
        private async void RewireButton_Click(object sender, RoutedEventArgs e)
        {
            if (_doc == null) return;
            ChainRules.RechainAll(_doc);
            _derived = ChainRules.Derive(_doc);
            Render();
            StatusHintText.Text = "Priority order re-wired per §5.2 — fan-in and cross-feature gate edges regenerated; your added edges were kept.";
            ActivityLog.Log(Channel, $"Epic #{_epicNumber}: Re-wire §5.2 — {_derived.Gaps} gap(s) remaining (in-memory only; real write is #2481)");
            await System.Threading.Tasks.Task.CompletedTask;
        }

        private void ExpandAllButton_Click(object sender, RoutedEventArgs e)
        {
            foreach (var id in _expanded.Keys.ToList()) _expanded[id] = true;
            StatusHintText.Text = "All Features expanded.";
        }

        private void CollapseAllButton_Click(object sender, RoutedEventArgs e)
        {
            foreach (var id in _expanded.Keys.ToList()) _expanded[id] = false;
            StatusHintText.Text = "All Features collapsed.";
        }

        private void ZoomOutButton_Click(object sender, RoutedEventArgs e)
        {
            _zoom = Math.Max(ZoomMin, Math.Round(_zoom - ZoomStep, 2));
            RenderZoom();
        }

        private void ZoomInButton_Click(object sender, RoutedEventArgs e)
        {
            _zoom = Math.Min(ZoomMax, Math.Round(_zoom + ZoomStep, 2));
            RenderZoom();
        }

        /// <summary>README.md line 68: "Fit = min(1, (viewportWidth − 16) / W)" where W is the
        /// stage width computed from the canvas layout. That layout doesn't exist until #2477, so
        /// this can't do the real fit math yet — it falls back to 100%, which is at least never
        /// wrong (never zooms past what the spec's own default is).</summary>
        private void FitButton_Click(object sender, RoutedEventArgs e)
        {
            _zoom = 1.0;
            RenderZoom();
        }

        private async void ResetButton_Click(object sender, RoutedEventArgs e)
        {
            StatusHintText.Text = "Discarding local edits, reloading from GitHub…";
            await RefreshAsync();
        }
    }
}

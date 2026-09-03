using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using BuildConsole.Services;
using BuildConsole.Services.BuildMap;

namespace BuildConsole
{
    /// <summary>
    /// Git #2482 (top bar + status strip) + Git #2479 (Build Chain Map, item #5 of #2473's
    /// structured index — the Inspector, all four views) together assemble the window body:
    /// <see cref="ChainCanvasControl"/> (#2477 nodes + #2478 edges) is mounted as the canvas
    /// (that plumbing — the control existed but nothing hosted it — is #2479's own doing, since
    /// the Inspector needs real selection events to be anything but a placeholder), and the
    /// Inspector itself lives in the <c>BuildChainMapWindow.Inspector.cs</c> partial.
    ///
    /// Design source: <c>desktop/BuildConsole/BuildMap/README.md</c> ("Top bar contents", "Status
    /// strip", "Inspector (right panel)") + the real reference screenshots under
    /// <c>BuildMap/screenshots/</c>. Everything shown — the 7 stat chips, the chain-integrity
    /// pill's exact/gap count, the status-strip edge counts, every Inspector field — comes
    /// straight out of <see cref="ChainRules.Derive"/>'s real <see cref="ChainDerived"/> snapshot
    /// of a real <see cref="ChainDoc"/>; nothing here is invented.
    ///
    /// Interactions (#2480's own structured-index item) and real-write persistence (#2481) are
    /// still separate, open sub-issues of #2473 — but the Inspector's own buttons/selects/switches
    /// documented in the README's "Inspector" section (board status, sentinel, manual gate,
    /// reorder, add/remove blocker) are real, in-memory `ChainDoc` writes here, following the same
    /// "in-memory only, real write is #2481" precedent the top bar's own Re-wire §5.2 button
    /// already established — see <c>BuildChainMapWindow.Inspector.cs</c>'s own class doc for why
    /// that line is drawn where it is.
    /// </summary>
    public partial class BuildChainMapWindow : Window
    {
        private readonly int _epicNumber;

        private ChainDoc? _doc;
        private ChainDerived? _derived;
        private double _zoom = 1.0;
        private bool _busy;

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

            // Git #2479 — the canvas (#2477/#2478) is mounted in XAML; wire it to the inspector and
            // to keyboard shortcuts the README documents as part of selection/edge behavior.
            Canvas.SelectionChanged += (_, __) => { RenderInspector(); RenderStatusStrip(); };
            Canvas.EdgeSelectionChanged += (_, __) => { RenderInspector(); RenderStatusStrip(); };
            Canvas.LinkModeChanged += (_, __) => { RenderInspector(); RenderStatusStrip(); };
            Canvas.GatePillClicked += (_, fid) => ToggleManualGate(fid);
            Canvas.ZoomChanged += (_, __) => { _zoom = Canvas.Zoom; RenderZoom(); };
            Canvas.EdgeLinked += (_, args) => ShowConfirmation(args.WasNew
                ? $"#{args.To} is now blocked_by #{args.From}."
                : $"#{args.To} was already blocked_by #{args.From}.");
            PreviewKeyDown += Window_PreviewKeyDown;

            Loaded += async (_, __) => await RefreshAsync();
        }

        /// <summary>README "Interactions": `Delete`/`Backspace` removes the selected edge bundle;
        /// `Esc` first cancels link mode, then clears selection.</summary>
        private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape)
            {
                if (Canvas.LinkModeTargetIssue != null) Canvas.CancelLinkMode();
                else Canvas.ClearSelection();
                e.Handled = true;
            }
            else if (e.Key == Key.Delete || e.Key == Key.Back)
            {
                var selected = Canvas.SelectedEdges;
                if (selected.Count > 0)
                {
                    RemoveEdges(selected);
                    e.Handled = true;
                }
            }
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
                CanvasPlaceholderText.Visibility = Visibility.Visible;

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

                _derived = ChainRules.Derive(_doc);
                Canvas.SetDocument(_doc);
                CanvasPlaceholderText.Visibility = Visibility.Collapsed;
                Render();
                RenderInspector();
                ActivityLog.Log(Channel, $"Epic #{_epicNumber}: loaded {_doc.Features.Count} Features, "
                    + $"{_derived.Totals.Issues} issues, {_derived.Gaps} chain gap(s)");
            }
            catch (Exception ex)
            {
                StatusHintText.Text = $"Couldn't load Epic #{_epicNumber}: {ex.Message}";
                CanvasPlaceholderText.Text = $"Couldn't load Epic #{_epicNumber} from GitHub.\n{ex.Message}";
                CanvasPlaceholderText.Visibility = Visibility.Visible;
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
        /// "{fanin} fan-in · {gate} gate · {manual} added". README "Status-strip hint": link mode
        /// overrides the default hint in amber, per #2479's inspector "Add blocker…" flow.</summary>
        private void RenderStatusStrip()
        {
            if (_derived == null) return;
            var d = _derived;
            StatusHintText.Text = Canvas.LinkModeTargetIssue is int target
                ? $"Pick a blocker for #{target}: click any issue node. Esc cancels."
                : "Click a Feature to open its issues · drag a header to change priority · "
                    + "click an issue to see what holds it · click an edge to inspect or remove it";
            StatusHintText.Foreground = Canvas.LinkModeTargetIssue != null
                ? (Brush)new BrushConverter().ConvertFromString("#e0a879")!
                : (Brush)new BrushConverter().ConvertFromString("#8b949e")!;
            StatusCountsText.Text = $"{d.FanInCount} fan-in · {d.GateCount} gate · {d.ManualCount} added";
        }

        private void RenderZoom() => ZoomPercentText.Text = $"{Math.Round(_zoom * 100)}%";

        // ── Controls ─────────────────────────────────────────────────────────────────────
        private async void RewireButton_Click(object sender, RoutedEventArgs e)
        {
            if (_doc == null) return;
            ChainRules.RechainAll(_doc);
            _derived = ChainRules.Derive(_doc);
            Canvas.Rerender();
            Render();
            RenderInspector();
            ShowConfirmation("Priority order re-wired per §5.2 — fan-in and cross-feature gate edges regenerated; your added edges were kept.");
            ActivityLog.Log(Channel, $"Epic #{_epicNumber}: Re-wire §5.2 — {_derived.Gaps} gap(s) remaining (in-memory only; real write is #2481)");
            await System.Threading.Tasks.Task.CompletedTask;
        }

        private void ExpandAllButton_Click(object sender, RoutedEventArgs e)
        {
            Canvas.ExpandAll();
            ShowConfirmation("All Features expanded.");
        }

        private void CollapseAllButton_Click(object sender, RoutedEventArgs e)
        {
            Canvas.CollapseAll();
            ShowConfirmation("All Features collapsed.");
        }

        private void ZoomOutButton_Click(object sender, RoutedEventArgs e) => Canvas.ZoomOut();

        private void ZoomInButton_Click(object sender, RoutedEventArgs e) => Canvas.ZoomIn();

        /// <summary>README.md line 68: "Fit = min(1, (viewportWidth − 16) / W)" — now the real
        /// calculation against the mounted canvas's own layout (<see cref="ChainLayout.FitZoom"/>).</summary>
        private void FitButton_Click(object sender, RoutedEventArgs e) => Canvas.Fit();

        private async void ResetButton_Click(object sender, RoutedEventArgs e)
        {
            ShowConfirmation("Discarding local edits, reloading from GitHub…");
            await RefreshAsync();
        }
    }
}

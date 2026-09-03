using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using BuildConsole.Services;
using BuildConsole.Services.BuildMap;

namespace BuildConsole
{
    /// <summary>
    /// Git #2479 (Build Chain Map, item #5 of #2473's structured index) — the Inspector (right
    /// panel), all four views: nothing/Feature/Issue/edge selected. Design source:
    /// <c>desktop/BuildConsole/BuildMap/README.md</c> ("Inspector (right panel) — four views") +
    /// the real reference screenshots under <c>BuildMap/screenshots/</c> + the exact copy strings
    /// in <c>Build Chain Map.dc.html</c>'s own <c>class Component</c> (the README's prose
    /// paraphrases some of these; the .dc.html literals are reproduced verbatim below, since this
    /// is user-facing text CLAUDE.md says to copy precisely).
    ///
    /// Driven entirely by <see cref="BuildChainMapWindow.Canvas"/>'s real selection state
    /// (<c>SelectedIssueNum</c> / <c>SelectedFeatureId</c> / <c>SelectedEdges</c>) — nothing here
    /// is fixture data; every number/edge/status comes from the real <see cref="ChainDoc"/>/
    /// <see cref="ChainDerived"/> #2475/#2476 already produce from GitHub.
    ///
    /// Board status / sentinel / manual-gate / reorder / add-remove-blocker mutations are ported 1:1
    /// from the reference's own <c>setStatus</c>/<c>makeSentinel</c>/<c>toggleGate</c>/
    /// <c>moveFeature</c>/<c>removeEdges</c>/<c>clickIssue</c> (link mode) methods, and — as of Git
    /// #2481 — each one now writes back to GitHub for real: every mutation captures a
    /// <see cref="ChainSnapshot"/> at entry, runs the in-memory <see cref="ChainDoc"/> edit, then hands
    /// both snapshots to <see cref="PersistThenConfirm"/> → <see cref="ChainPersistence"/>, which
    /// diffs and applies the real blocked_by/board writes and re-reads each to audit it. The
    /// status-strip confirmation shows the real verified result. The one gap left is persisting the
    /// sub-issue priority ORDER itself (no primitive in the three named write types — the gate edges a
    /// reorder produces DO persist); see #2481's filed findings.
    /// </summary>
    public partial class BuildChainMapWindow
    {
        // ---- palette (README "Design tokens") — re-declared locally rather than shared with
        // ChainCanvasControl's own private statics, same per-file convention its EdgeLayer partial
        // already uses (see that file's own comment on why). ----
        private static readonly Brush InsCardBg = InsFrozen("#0f1319");
        private static readonly Brush InsSentinelBg = InsFrozen("#0e141c");
        private static readonly Brush InsBorder1 = InsFrozen("#1b212a");
        private static readonly Brush InsBorder2 = InsFrozen("#21262d");
        private static readonly Brush InsBorder3 = InsFrozen("#2e3742");
        private static readonly Brush InsTextHi = InsFrozen("#e6edf3");
        private static readonly Brush InsTextMid = InsFrozen("#c9d1d9");
        private static readonly Brush InsTextDim = InsFrozen("#8b949e");
        private static readonly Brush InsTextFaint = InsFrozen("#576069");
        private static readonly Brush InsTextGhost = InsFrozen("#3f4756");
        private static readonly Brush InsBlueFill = InsFrozen("#1d3450");
        private static readonly Brush InsBlueBorder = InsFrozen("#3d5875");
        private static readonly Brush InsBlue = InsFrozen("#4d7aa8");
        private static readonly Brush InsBlueSoft = InsFrozen("#6a8fb5");
        private static readonly Brush InsBlueLight = InsFrozen("#9fc0dd");
        private static readonly Brush InsBlueLighter = InsFrozen("#cfe0f0");
        private static readonly Brush InsGreen = InsFrozen("#7fb08a");
        private static readonly Brush InsGreenDim = InsFrozen("#5f9a6c");
        private static readonly Brush InsGreenDark = InsFrozen("#2f5a3a");
        private static readonly Brush InsAmber = InsFrozen("#e0a879");
        private static readonly Brush InsAmberBorder = InsFrozen("#5a3f2a");
        private static readonly Brush InsAmberBg = InsFrozen("#1a1512");
        private static readonly Brush InsAmberKnobOff = InsFrozen("#8b949e");
        private static readonly Brush InsViolet = InsFrozen("#a374ea");
        private static readonly Brush InsVioletDim = InsFrozen("#8b7aa8");
        private static readonly Brush InsRed = InsFrozen("#e8746f");
        private static readonly Brush InsRedBorder = InsFrozen("#4a2320");
        private static readonly Brush InsRedBg = InsFrozen("#1d1211");
        private static readonly Brush InsHeldDot = InsFrozen("#6b7480");

        private static readonly FontFamily InsUiFont = new("Segoe UI");
        private static readonly FontFamily InsMonoFont = new("Consolas, Menlo, monospace");

        // Lucide 24x24 geometries (2px stroke) this view needs beyond what ChainCanvasControl's
        // own local dictionary already covers — same "small local dict, no shared XAML resource"
        // pattern that control already established for its own icons.
        private static readonly Dictionary<string, string> InsIconPaths = new()
        {
            ["lock"] = "M5 11 H19 a2 2 0 0 1 2 2 v6 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 v-6 a2 2 0 0 1 2 -2 Z M7 11 V7 a5 5 0 0 1 10 0 v4",
            ["corner-up-right"] = "M15 14 L20 9 L15 4 M4 20 V13 A4 4 0 0 1 8 9 H20",
            ["target"] = "M22 12 a10 10 0 1 1 -20 0 a10 10 0 0 1 20 0 M18 12 a6 6 0 1 1 -12 0 a6 6 0 0 1 12 0 M14 12 a2 2 0 1 1 -4 0 a2 2 0 0 1 4 0",
            ["x"] = "M18 6 L6 18 M6 6 L18 18",
            ["trash-2"] = "M3 6 H21 M19 6 V20 A2 2 0 0 1 17 22 H7 A2 2 0 0 1 5 20 V6 M8 6 V4 A2 2 0 0 1 10 2 H14 A2 2 0 0 1 16 4 V6 M10 11 V17 M14 11 V17",
            ["arrow-left"] = "M19 12 H5 M12 5 L5 12 L12 19",
            ["arrow-right"] = "M5 12 H19 M12 5 L19 12 L12 19",
        };

        // ── Dispatcher ──────────────────────────────────────────────────────────────────────

        /// <summary>Re-renders the whole Inspector from scratch against the canvas's current
        /// selection — same render-from-scratch pattern <c>ChainCanvasControl.Render()</c> already
        /// uses, called on every selection/edge-selection/link-mode/document change.</summary>
        private void RenderInspector()
        {
            InspectorHost.Children.Clear();
            if (_doc == null || _derived == null) return;

            if (Canvas.SelectedIssueNum is int selIssue && ChainRules.FindIssue(_doc, selIssue) is ChainIssue issue)
                RenderInspectorIssue(issue);
            else if (Canvas.SelectedFeatureId is string selFeatureId && ChainRules.FindFeature(_doc, selFeatureId) is ChainFeature feature)
                RenderInspectorFeature(feature);
            else if (Canvas.SelectedEdges.Count > 0)
                RenderInspectorEdge(Canvas.SelectedEdges);
            else
                RenderInspectorNothing();
        }

        // ── Nothing selected — README "Nothing selected" ───────────────────────────────────

        private void RenderInspectorNothing()
        {
            var d = _derived!;

            AddSection(InsColumn(
                InsEyebrow("How to read this"),
                InsText("Left to right is priority order. Each Feature collapses to one card. Open it and its issues fan into a sentinel; that sentinel gates every issue in the next Feature. Select any node and the edges that hold it turn amber.",
                    12, InsTextDim, margin: new Thickness(0, 7, 0, 0))));

            var nodeLegend = new StackPanel();
            foreach (var (label, dot, desc) in new (string, Func<Ellipse>, string)[]
            {
                ("Ready", () => InsStateDot(ChainNodeState.Ready), "Batter Up with no open blockers. Launches on the next refresh."),
                ("Waiting", () => InsStateDot(ChainNodeState.Blocked), "Batter Up, waiting on blocked_by edges to clear. The number is how many."),
                ("Held (Backlog)", () => InsStateDot(ChainNodeState.Held), "Backlog. A human moves it, even after its edges clear."),
                ("Ask Shane", () => InsStateDot(ChainNodeState.Ask), "Ask Shane. An open question with no build attached; outside the cascade."),
                ("Done", () => InsStateDot(ChainNodeState.Done), "Verified DONE bookend on origin/main."),
            })
                nodeLegend.Children.Add(InsLegendRow(dot(), label, desc));
            AddSection(nodeLegend);

            var edgeLegend = new StackPanel();
            foreach (var (label, stroke, dashed, desc) in new (string, Brush, bool, string)[]
            {
                ("Fan-in", InsBlue, false, "Every sibling → its Feature’s sentinel. The sentinel is provably the last thing to clear."),
                ("Cross-feature gate", InsBlueSoft, false, "Previous sentinel → every issue in the next Feature. O(n) per transition."),
                ("Manual gate", InsAmber, true, "Same edge plus a human. Downstream issues wait in Backlog, not Batter Up."),
                ("Added by you", InsViolet, false, "A blocked_by edge outside the §5.2 pattern. Kept through re-wires."),
            })
                edgeLegend.Children.Add(InsLegendRow(InsEdgeSwatch(stroke, dashed), label, desc));
            edgeLegend.Margin = new Thickness(0, 3, 0, 0);
            edgeLegend.Children.Insert(0, new Border { BorderBrush = InsBorder1, BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(0, 10, 0, 0) });
            AddSection(edgeLegend);

            string methodText = $"{d.FanInCount} fan-in and {d.GateCount} gate edges chain {d.Totals.Issues} issues across {_doc!.Features.Count} Features. "
                + $"Wiring every next-Feature issue to every previous-Feature issue would take {d.Cross} edges."
                + (d.ManualCount > 0 ? $" Plus {d.ManualCount} added by you." : "");
            AddSection(InsCard(InsColumn(
                InsText("§5.2 in numbers", 10.5, InsTextHi, FontWeights.Bold),
                InsText(methodText, 10.5, InsTextDim, margin: new Thickness(0, 5, 0, 0))),
                InsCardBg, InsBorder1, leftAccent: InsBlue));

            AddSection(InsCard(
                InsText("Real GitHub data — issue numbers, titles and blocked_by edges are live, not seeded. "
                    + "Sentinel, gate, board-status and blocked_by edits write straight back to GitHub — each is "
                    + "re-read to confirm it landed. Reset reloads fresh from GitHub.",
                    10.5, InsTextDim),
                InsCardBg, InsBorder3, dashed: true));
        }

        private static StackPanel InsLegendRow(FrameworkElement swatch, string label, string desc)
        {
            var row = new Grid { Margin = new Thickness(0, 7, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            swatch.Margin = new Thickness(0, 3, 9, 0);
            swatch.VerticalAlignment = VerticalAlignment.Top;
            Grid.SetColumn(swatch, 0);
            var text = InsColumn(InsText(label, 10.5, InsTextMid, FontWeights.Bold),
                InsText(desc, 10, InsTextFaint, margin: new Thickness(0, 1, 0, 0)));
            Grid.SetColumn(text, 1);
            var wrap = new StackPanel();
            var grid = new Grid();
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            Grid.SetColumn(swatch, 0);
            grid.Children.Add(swatch);
            Grid.SetColumn(text, 1);
            grid.Children.Add(text);
            grid.Margin = new Thickness(0, 7, 0, 0);
            wrap.Children.Add(grid);
            return wrap;
        }

        private static FrameworkElement InsEdgeSwatch(Brush stroke, bool dashed)
        {
            var line = new Rectangle { Width = 18, Height = 0, Stroke = stroke, StrokeThickness = 1.5, SnapsToDevicePixels = true };
            if (dashed) line.StrokeDashArray = new DoubleCollection { 3, 2 };
            return new Border { Width = 18, Height = 11, Child = line, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 3, 9, 0) };
        }

        // ── Feature selected — README "Feature selected" ───────────────────────────────────

        private void RenderInspectorFeature(ChainFeature feature)
        {
            var d = _derived!;
            var doc = _doc!;
            int k = doc.Order.IndexOf(feature.Id);
            var summary = d.FeatureSummary[feature.Id];
            var prev = k > 0 ? ChainRules.FindFeature(doc, doc.Order[k - 1]) : null;
            var next = k < doc.Order.Count - 1 ? ChainRules.FindFeature(doc, doc.Order[k + 1]) : null;
            bool manual = doc.Gates.TryGetValue(feature.Id, out var g) && g;
            int cascadeCount = ChainRules.Cascade(feature).Count;

            AddSection(InsColumn(
                HRow(6,
                    InsBadge("P" + (k + 1)),
                    InsEyebrow("Feature"),
                    InsSpacer(),
                    InsMono("#" + feature.Num, 9.5, InsTextFaint)),
                InsText(feature.Name, 16, InsTextHi, FontWeights.ExtraBold, margin: new Thickness(0, 6, 0, 0)),
                InsMono($"buildSet={feature.Short} · {feature.Issues.Count} issues · {cascadeCount} in cascade", 9.5, InsTextFaint,
                    margin: new Thickness(0, 4, 0, 0))));

            var tiles = new Grid();
            var tileSpecs = new (string Label, int Value, Brush Color)[]
            {
                ("READY", summary.Ready, InsGreen), ("WAITS", summary.Blocked, InsBlueSoft),
                ("HELD", summary.Held, InsTextDim), ("ASK", summary.Ask, InsViolet), ("DONE", summary.Done, InsGreenDim),
            };
            foreach (var spec in tileSpecs)
            {
                tiles.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var tile = new Border
                {
                    Background = InsCardBg, BorderBrush = InsBorder1, BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(6), Padding = new Thickness(7, 6, 7, 6),
                    Margin = new Thickness(tiles.ColumnDefinitions.Count > 1 ? 4 : 0, 0, 0, 0),
                    Child = InsColumn(
                        InsText(spec.Label, 7.5, InsTextFaint, FontWeights.ExtraBold),
                        InsMono(spec.Value.ToString(), 15, spec.Value > 0 ? spec.Color : InsTextGhost, FontWeights.ExtraBold, margin: new Thickness(0, 2, 0, 0))),
                };
                Grid.SetColumn(tile, tiles.ColumnDefinitions.Count - 1);
                tiles.Children.Add(tile);
            }
            AddSection(tiles);

            string gatedOn = prev != null
                ? $"Gated on #{prev.Sentinel}, the sentinel of {prev.Name}" + (manual ? ", plus Shane’s confirmation." : ". Launches automatically when it clears.")
                : "First in priority. Nothing gates it.";
            string releases = next != null
                ? $"Its sentinel #{feature.Sentinel} releases {next.Name} ({ChainRules.Cascade(next).Count} issues)."
                : "Last in priority. Releases nothing.";
            AddSection(InsColumn(
                InsFactLine("lock", gatedOn),
                InsFactLine("corner-up-right", releases, margin: new Thickness(0, 6, 0, 0))));

            // Sentinel select — README: "<select> listing the cascade issues, highest first."
            var cascadeDesc = ChainRules.Cascade(feature).OrderByDescending(i => i.Num).ToList();
            var sentinelCombo = new ComboBox
            {
                Height = 26, FontSize = 10.5, FontFamily = InsUiFont,
                Background = InsCardBg, BorderBrush = InsBorder2, Foreground = InsTextMid,
                Margin = new Thickness(0, 8, 0, 0),
            };
            foreach (var i in cascadeDesc)
                sentinelCombo.Items.Add(new ComboBoxItem { Content = $"#{i.Num} {i.Title}", Tag = i.Num, Foreground = InsTextMid, Background = InsCardBg });
            sentinelCombo.SelectedItem = sentinelCombo.Items.Cast<ComboBoxItem>().FirstOrDefault(it => (int)it.Tag == feature.Sentinel);
            sentinelCombo.SelectionChanged += (_, __) =>
            {
                if (sentinelCombo.SelectedItem is ComboBoxItem { Tag: int newSentinel } && newSentinel != feature.Sentinel)
                    MakeSentinel(newSentinel);
            };
            AddSection(InsColumn(
                HRow(6, InsIconEl("target", 11, InsBlueSoft), InsEyebrow("Sentinel")),
                sentinelCombo,
                InsText("Highest-numbered issue by default. Changing it re-wires the fan-in and the downstream gate.",
                    10, InsTextFaint, margin: new Thickness(0, 6, 0, 0))));

            // Gate before this Feature — hidden for P1 (k == 0).
            if (k > 0)
            {
                string gateText = manual
                    ? "Manual. Issues wait in Backlog until Shane moves them, even after the sentinel clears."
                    : "Automatic. Issues launch on refresh once the previous sentinel posts DONE.";
                string fidCopy = feature.Id;
                var switchEl = InsSwitch(manual);
                var gateCard = new Border
                {
                    Background = InsCardBg, BorderBrush = InsBorder1, BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(7), Padding = new Thickness(10, 9, 10, 9), Cursor = System.Windows.Input.Cursors.Hand,
                };
                var row = new Grid();
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var textCol = InsColumn(
                    InsText("Gate before this Feature", 10.5, InsTextHi, FontWeights.Bold),
                    InsText(gateText, 10, InsTextDim, margin: new Thickness(0, 2, 0, 0)));
                Grid.SetColumn(textCol, 0);
                row.Children.Add(textCol);
                switchEl.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(switchEl, 1);
                row.Children.Add(switchEl);
                gateCard.Child = row;
                gateCard.MouseLeftButtonDown += (_, e) => { e.Handled = true; ToggleManualGate(fidCopy); };
                AddSection(gateCard);
            }

            // Open/Collapse issues + reorder arrows.
            var toggleBtn = InsPrimaryButton(Canvas.ExpandedFeatures.Contains(feature.Id) ? "Collapse issues" : "Open issues");
            string fid2 = feature.Id;
            toggleBtn.Click += (_, __) => { Canvas.ToggleFeature(fid2); RenderInspector(); };
            var upBtn = InsIconButton("arrow-left", "Move earlier in priority");
            upBtn.IsEnabled = k > 0;
            upBtn.Click += (_, __) => MoveFeature(fid2, -1);
            var downBtn = InsIconButton("arrow-right", "Move later in priority");
            downBtn.IsEnabled = k < doc.Order.Count - 1;
            downBtn.Click += (_, __) => MoveFeature(fid2, 1);
            var buttonRow = new Grid();
            buttonRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            buttonRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            buttonRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(toggleBtn, 0);
            buttonRow.Children.Add(toggleBtn);
            upBtn.Margin = new Thickness(6, 0, 0, 0);
            Grid.SetColumn(upBtn, 1);
            buttonRow.Children.Add(upBtn);
            downBtn.Margin = new Thickness(6, 0, 0, 0);
            Grid.SetColumn(downBtn, 2);
            buttonRow.Children.Add(downBtn);
            AddSection(buttonRow);

            // Issues list.
            var issuesList = InsColumn(InsEyebrow("Issues", margin: new Thickness(0, 0, 0, 4)));
            foreach (var issue in feature.Issues.OrderBy(i => i.Num))
            {
                var state = d.State[issue.Num];
                string tag = state == ChainNodeState.Blocked ? $"waits {d.OpenBlockers[issue.Num]}" : InsStateLabel(state);
                var rowGrid = new Grid { Margin = new Thickness(0, 4, 0, 0), Cursor = System.Windows.Input.Cursors.Hand };
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                rowGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var dot = InsStateDot(state, 6);
                dot.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(dot, 0);
                rowGrid.Children.Add(dot);
                var num = InsMono("#" + issue.Num, 9, InsTextFaint);
                num.Margin = new Thickness(7, 0, 0, 0);
                num.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(num, 1);
                rowGrid.Children.Add(num);
                var title = InsText(issue.Title, 10.5, InsTextMid);
                title.TextTrimming = TextTrimming.CharacterEllipsis;
                title.Margin = new Thickness(7, 0, 6, 0);
                title.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(title, 2);
                rowGrid.Children.Add(title);
                if (issue.Num == feature.Sentinel)
                {
                    var targetIcon = InsIconEl("target", 10, InsBlueSoft);
                    targetIcon.Margin = new Thickness(0, 0, 6, 0);
                    Grid.SetColumn(targetIcon, 3);
                    rowGrid.Children.Add(targetIcon);
                }
                var tagText = InsMono(tag.ToUpperInvariant(), 8.5, InsStateColor(state), FontWeights.ExtraBold);
                tagText.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(tagText, 4);
                rowGrid.Children.Add(tagText);
                int numCopy = issue.Num;
                rowGrid.MouseLeftButtonDown += (_, e) => { e.Handled = true; Canvas.SelectIssue(numCopy, ensureExpanded: true); };
                issuesList.Children.Add(rowGrid);
            }
            AddSection(issuesList);
        }

        private static StackPanel InsFactLine(string icon, string text, Thickness? margin = null)
        {
            var grid = new Grid { Margin = margin ?? new Thickness(0) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var icn = InsIconEl(icon, 11, InsBlueSoft);
            icn.VerticalAlignment = VerticalAlignment.Top;
            icn.Margin = new Thickness(0, 3, 7, 0);
            Grid.SetColumn(icn, 0);
            grid.Children.Add(icn);
            var t = InsText(text, 10.5, InsTextDim);
            Grid.SetColumn(t, 1);
            grid.Children.Add(t);
            var wrap = new StackPanel();
            wrap.Children.Add(grid);
            return wrap;
        }

        // ── Issue selected — README "Issue selected" ────────────────────────────────────────

        private void RenderInspectorIssue(ChainIssue issue)
        {
            var d = _derived!;
            var doc = _doc!;
            var feature = d.FeatureOf[issue.Num];
            int k = doc.Order.IndexOf(feature.Id);
            var state = d.State[issue.Num];
            bool isSentinel = feature.Sentinel == issue.Num;
            var incoming = d.IncomingEdges.TryGetValue(issue.Num, out var inc) ? inc : new List<ChainEdge>();
            var outgoing = d.OutgoingEdges.TryGetValue(issue.Num, out var outg) ? outg : new List<ChainEdge>();

            string stateLabel = state switch
            {
                ChainNodeState.Blocked => $"Waiting on {d.OpenBlockers[issue.Num]} blocker" + (d.OpenBlockers[issue.Num] == 1 ? "" : "s"),
                ChainNodeState.Ready => "Ready — launches on the next refresh",
                ChainNodeState.Held => "Held in Backlog",
                ChainNodeState.Ask => "Ask Shane — outside the cascade",
                _ => "DONE bookend verified",
            };

            AddSection(InsColumn(
                HRow(6, InsEyebrow("Issue"), InsMono($"{feature.Name} · P{k + 1}", 9.5, InsTextFaint), InsSpacer(), InsMono("#" + issue.Num, 9.5, InsTextFaint)),
                InsText(issue.Title, 15, InsTextHi, FontWeights.ExtraBold, margin: new Thickness(0, 6, 0, 0)),
                HRow(7,
                    Pad(InsStateDot(state, 8), new Thickness(0, 7, 0, 0)),
                    Pad(InsText(stateLabel, 10.5, InsStateColor(state), FontWeights.Bold), new Thickness(0, 7, 0, 0)))));

            if (isSentinel)
            {
                int fanInSiblings = incoming.Count(e => e.Kind == ChainEdgeKind.FanIn);
                AddSection(InsCard(HRow(7,
                        Pad(InsIconEl("target", 11, InsBlueSoft), new Thickness(0, 0, 0, 0)),
                        InsText($"Sentinel of {feature.Name}: {fanInSiblings} siblings fan in here. It is the last thing in the Feature to clear.", 10, InsBlueLight)),
                    InsSentinelBg, InsBlueBorder));
            }

            // Board status — four equal buttons.
            var statusGrid = new Grid();
            var statuses = new (ChainStatus Status, string Label)[]
            {
                (ChainStatus.Batter, "Batter Up"), (ChainStatus.Backlog, "Backlog"),
                (ChainStatus.Ask, "Ask Shane"), (ChainStatus.Done, "Done"),
            };
            foreach (var (status, label) in statuses)
            {
                statusGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                bool active = issue.Status == status;
                var btn = new Button
                {
                    Content = label, Height = 24, FontSize = 9.5, FontWeight = FontWeights.Bold, FontFamily = InsUiFont,
                    Background = active ? InsBlueFill : InsCardBg, BorderBrush = active ? InsBlueBorder : InsBorder2,
                    Foreground = active ? InsBlueLighter : InsTextDim, BorderThickness = new Thickness(1),
                    Margin = new Thickness(statusGrid.ColumnDefinitions.Count > 1 ? 4 : 0, 0, 0, 0),
                    Cursor = System.Windows.Input.Cursors.Hand,
                };
                int numCopy = issue.Num;
                btn.Click += (_, __) => SetIssueStatus(numCopy, status);
                Grid.SetColumn(btn, statusGrid.ColumnDefinitions.Count - 1);
                statusGrid.Children.Add(btn);
            }
            AddSection(InsColumn(InsEyebrow("Board status", margin: new Thickness(0, 0, 0, 6)), statusGrid));

            // Blocked by.
            bool linking = Canvas.LinkModeTargetIssue == issue.Num;
            var addBtn = new Button
            {
                Content = linking ? "Cancel" : "Add blocker…", Height = 20, Padding = new Thickness(8, 0, 8, 0),
                FontSize = 9.5, FontWeight = FontWeights.Bold, FontFamily = InsUiFont,
                Background = linking ? InsAmberBg : InsBlueFill, BorderBrush = linking ? InsAmberBorder : InsBlueBorder,
                Foreground = linking ? InsAmber : InsBlueLighter, BorderThickness = new Thickness(1),
                HorizontalAlignment = HorizontalAlignment.Right, Cursor = System.Windows.Input.Cursors.Hand,
            };
            int issueNum = issue.Num;
            addBtn.Click += (_, __) => ToggleLinkMode(issueNum);
            var blockedByHeader = new Grid();
            blockedByHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            blockedByHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            blockedByHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            blockedByHeader.Children.Add(InsEyebrow("Blocked by"));
            var blockedByCount = InsMono(incoming.Count.ToString(), 9, InsTextFaint);
            blockedByCount.Margin = new Thickness(7, 0, 0, 0);
            Grid.SetColumn(blockedByCount, 1);
            blockedByHeader.Children.Add(blockedByCount);
            Grid.SetColumn(addBtn, 2);
            blockedByHeader.Children.Add(addBtn);

            var blockedBySection = InsColumn(blockedByHeader);
            if (incoming.Count == 0)
                blockedBySection.Children.Add(InsText("Nothing. Launches on the next refresh if it is in Batter Up.", 10.5, InsTextFaint, margin: new Thickness(0, 4, 0, 0)));
            else
                foreach (var edge in incoming)
                    blockedBySection.Children.Add(InsEdgeRow(edge.From, d, InsSimpleKindLabel(edge.Kind), () => Canvas.SelectIssue(edge.From, true), () => RemoveEdges(new[] { edge })));
            AddSection(blockedBySection);

            // Blocks.
            var blocksHeader = new Grid();
            blocksHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            blocksHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            blocksHeader.Children.Add(InsEyebrow("Blocks"));
            var blocksCount = InsMono(outgoing.Count.ToString(), 9, InsTextFaint);
            blocksCount.Margin = new Thickness(7, 0, 0, 0);
            Grid.SetColumn(blocksCount, 1);
            blocksHeader.Children.Add(blocksCount);
            var blocksSection = InsColumn(blocksHeader);
            if (outgoing.Count == 0)
                blocksSection.Children.Add(InsText("Nothing waits on this issue.", 10.5, InsTextFaint, margin: new Thickness(0, 4, 0, 0)));
            else
                foreach (var edge in outgoing)
                    blocksSection.Children.Add(InsEdgeRow(edge.To, d, InsSimpleKindLabel(edge.Kind), () => Canvas.SelectIssue(edge.To, true), () => RemoveEdges(new[] { edge })));
            AddSection(blocksSection);

            // Make this the sentinel — hidden if already sentinel or Ask Shane.
            if (!isSentinel && issue.Status != ChainStatus.Ask)
            {
                var makeSentinelBtn = new Button
                {
                    Height = 26, FontSize = 10.5, FontWeight = FontWeights.Bold, FontFamily = InsUiFont,
                    Background = InsCardBg, BorderBrush = InsBlueBorder, Foreground = InsBlueLight,
                    BorderThickness = new Thickness(1), Cursor = System.Windows.Input.Cursors.Hand,
                    Content = HRow(6, InsIconEl("target", 11, InsBlueLight), InsText("Make this the sentinel", 10.5, InsBlueLight, FontWeights.Bold)),
                };
                makeSentinelBtn.Click += (_, __) => MakeSentinel(issueNum);
                AddSection(makeSentinelBtn);
            }

            // Dispatch.
            var dispatchSection = InsColumn(InsEyebrow("Dispatch", margin: new Thickness(0, 0, 0, 6)));
            if (issue.Status != ChainStatus.Ask)
            {
                string model = string.IsNullOrEmpty(issue.Model) ? "—" : issue.Model;
                string effort = string.IsNullOrEmpty(issue.Effort) ? "—" : issue.Effort;
                var blockedByNums = incoming.Select(e => e.From).OrderBy(n => n).ToList();
                string build1 = $"BUILD: model={model} effort={effort} buildSet={feature.Short}";
                string build2 = $"--model {model} --effort {effort} --title {issue.Num}"
                    + (blockedByNums.Count > 0 ? $" --blocked-by {string.Join(",", blockedByNums)}" : "");
                dispatchSection.Children.Add(new Border
                {
                    Background = InsFrozen("#0a0d12"), BorderBrush = InsBorder1, BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(6), Padding = new Thickness(9, 8, 9, 8),
                    Child = InsColumn(InsMono(build1, 9.5, InsTextMid), InsMono(build2, 9.5, InsTextDim, margin: new Thickness(0, 2, 0, 0))),
                });
            }
            string buildNote = issue.Status == ChainStatus.Ask
                ? "No BUILD comment. An Ask Shane item carries a question, not a dispatch."
                : issue.Status == ChainStatus.Backlog
                    ? "Dispatched but held. Backlog waits for a human to move it to Batter Up."
                    : "";
            if (buildNote.Length > 0)
                dispatchSection.Children.Add(InsText(buildNote, 10, InsTextDim, margin: new Thickness(0, 6, 0, 0)));
            var dispatchBordered = new Border { BorderBrush = InsBorder1, BorderThickness = new Thickness(0, 1, 0, 0), Padding = new Thickness(0, 10, 0, 0), Child = dispatchSection };
            AddSection(dispatchBordered);
        }

        private static string InsSimpleKindLabel(ChainEdgeKind kind) => kind switch
        {
            ChainEdgeKind.FanIn => "fan-in",
            ChainEdgeKind.Gate => "gate",
            _ => "added",
        };

        private static Border InsEdgeRow(int num, ChainDerived d, string kindTag, Action onSelect, Action onRemove)
        {
            d.ByNum.TryGetValue(num, out var issue);
            var state = d.State.TryGetValue(num, out var s) ? s : (ChainNodeState?)null;

            var row = new Grid { Margin = new Thickness(0, 3, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var left = new StackPanel { Orientation = Orientation.Horizontal, Cursor = System.Windows.Input.Cursors.Hand };
            left.Children.Add(new Border { Width = 6, Child = state != null ? InsStateDot(state.Value, 6) : null, VerticalAlignment = VerticalAlignment.Center });
            var numText = InsMono("#" + num, 9, InsTextFaint);
            numText.Margin = new Thickness(6, 0, 0, 0);
            numText.VerticalAlignment = VerticalAlignment.Center;
            left.Children.Add(numText);
            var titleText = InsText(issue?.Title ?? "(missing)", 10.5, InsTextMid);
            titleText.TextTrimming = TextTrimming.CharacterEllipsis;
            titleText.Margin = new Thickness(6, 0, 0, 0);
            titleText.VerticalAlignment = VerticalAlignment.Center;
            titleText.MaxWidth = 150;
            left.Children.Add(titleText);
            left.MouseLeftButtonDown += (_, e) => { e.Handled = true; onSelect(); };
            Grid.SetColumn(left, 0);
            Grid.SetColumnSpan(left, 2);
            row.Children.Add(left);

            var kindText = InsMono(kindTag.ToUpperInvariant(), 8, InsTextFaint, FontWeights.ExtraBold);
            kindText.VerticalAlignment = VerticalAlignment.Center;
            kindText.Margin = new Thickness(6, 0, 0, 0);
            Grid.SetColumn(kindText, 2);
            row.Children.Add(kindText);

            var removeBtn = new Button
            {
                Content = InsIconEl("x", 11, InsTextFaint), Width = 18, Height = 18, Padding = new Thickness(0),
                Background = Brushes.Transparent, BorderThickness = new Thickness(0), Cursor = System.Windows.Input.Cursors.Hand,
                ToolTip = "Remove this blocked_by edge", Margin = new Thickness(4, 0, 0, 0),
            };
            removeBtn.Click += (_, __) => onRemove();
            Grid.SetColumn(removeBtn, 3);
            row.Children.Add(removeBtn);

            return new Border
            {
                Background = InsCardBg, BorderBrush = InsBorder1, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5), Padding = new Thickness(6, 4, 6, 4), Margin = new Thickness(0, 3, 0, 0),
                Child = row,
            };
        }

        // ── Edge (or bundle) selected — README "Edge (or bundle) selected" ─────────────────

        private void RenderInspectorEdge(IReadOnlyList<ChainEdge> edges)
        {
            var d = _derived!;
            var doc = _doc!;
            var e0 = edges[0];
            int from = e0.From;
            bool one = edges.Count == 1;
            d.ByNum.TryGetValue(from, out var fromIssue);
            d.FeatureOf.TryGetValue(from, out var fromFeature);
            d.FeatureOf.TryGetValue(e0.To, out var toFeature);

            var kinds = edges.Select(e => e.Kind).Distinct().ToList();
            string kindLabel = string.Join(" + ", kinds.Select(k => k switch
            {
                ChainEdgeKind.FanIn => "fan-in",
                ChainEdgeKind.Gate => toFeature != null && doc.Gates.TryGetValue(toFeature.Id, out var gg) && gg ? "manual gate" : "cross-feature gate",
                _ => "added by you",
            }));

            string headline = one
                ? $"#{e0.To} blocked_by #{from}"
                : $"{edges.Count} issues in {toFeature?.Name ?? ""} blocked_by #{from}";

            string desc = fromIssue != null && fromIssue.Status == ChainStatus.Done
                ? $"Cleared. #{from} has a DONE bookend, so this edge no longer holds anything."
                : one
                    ? $"#{e0.To} cannot launch until #{from} posts its DONE bookend."
                    : $"None of these launch until #{from} posts its DONE bookend. Open {toFeature?.Name ?? "the Feature"} to see each edge on its own.";

            AddSection(InsColumn(
                HRow(6, InsEyebrow("blocked_by edge"), InsSpacer(), InsText(kindLabel, 9.5, InsTextDim)),
                InsText(headline, 14, InsTextHi, FontWeights.ExtraBold, margin: new Thickness(0, 6, 0, 0)),
                InsText(desc, 10.5, InsTextDim, margin: new Thickness(0, 6, 0, 0))));

            var fromState = d.State.TryGetValue(from, out var fs) ? fs : (ChainNodeState?)null;
            var blockerCard = new Border
            {
                Background = InsCardBg, BorderBrush = InsBorder1, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6), Padding = new Thickness(9, 7, 9, 7), Cursor = System.Windows.Input.Cursors.Hand,
            };
            var blockerRow = new Grid();
            blockerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            blockerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            blockerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var blockerDot = fromState != null ? InsStateDot(fromState.Value, 8) : new Ellipse { Width = 8, Height = 8 };
            blockerDot.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(blockerDot, 0);
            blockerRow.Children.Add(blockerDot);
            var blockerText = InsColumn(
                InsEyebrow($"Blocker · {fromFeature?.Name ?? ""}", 8),
                new TextBlock
                {
                    Margin = new Thickness(0, 1, 0, 0), TextTrimming = TextTrimming.CharacterEllipsis,
                    Inlines = { new System.Windows.Documents.Run("#" + from + " ") { FontFamily = InsMonoFont, FontSize = 9, Foreground = InsTextDim },
                                new System.Windows.Documents.Run(fromIssue?.Title ?? "") { FontSize = 10.5, Foreground = InsTextMid } },
                });
            blockerText.Margin = new Thickness(7, 0, 0, 0);
            Grid.SetColumn(blockerText, 1);
            blockerRow.Children.Add(blockerText);
            var blockerTag = InsMono(fromState != null ? InsStateLabel(fromState.Value).ToUpperInvariant() : "", 8.5, fromState != null ? InsStateColor(fromState.Value) : InsTextFaint, FontWeights.ExtraBold);
            blockerTag.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(blockerTag, 2);
            blockerRow.Children.Add(blockerTag);
            blockerCard.Child = blockerRow;
            blockerCard.MouseLeftButtonDown += (_, e) => { e.Handled = true; Canvas.SelectIssue(from, true); };
            AddSection(blockerCard);

            var holdsHeader = new Grid();
            holdsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            holdsHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            holdsHeader.Children.Add(InsEyebrow("Holds"));
            var holdsCount = InsMono(edges.Count.ToString(), 9, InsTextFaint);
            holdsCount.Margin = new Thickness(7, 0, 0, 0);
            Grid.SetColumn(holdsCount, 1);
            holdsHeader.Children.Add(holdsCount);
            var holdsSection = InsColumn(holdsHeader);
            foreach (var edge in edges)
            {
                d.ByNum.TryGetValue(edge.To, out var toIssue);
                var row = new Grid { Margin = new Thickness(0, 3, 0, 0) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                var left = new StackPanel { Orientation = Orientation.Horizontal, Cursor = System.Windows.Input.Cursors.Hand };
                var numText = InsMono("#" + edge.To, 9, InsTextDim);
                left.Children.Add(numText);
                var titleText = InsText(toIssue?.Title ?? "(missing)", 10.5, InsTextMid);
                titleText.TextTrimming = TextTrimming.CharacterEllipsis;
                titleText.Margin = new Thickness(7, 0, 0, 0);
                titleText.MaxWidth = 170;
                left.Children.Add(titleText);
                var edgeCopy = edge;
                left.MouseLeftButtonDown += (_, e) => { e.Handled = true; Canvas.SelectIssue(edgeCopy.To, true); };
                Grid.SetColumn(left, 0);
                Grid.SetColumnSpan(left, 2);
                row.Children.Add(left);
                var removeBtn = new Button
                {
                    Content = InsIconEl("x", 11, InsTextFaint), Width = 18, Height = 18, Padding = new Thickness(0),
                    Background = Brushes.Transparent, BorderThickness = new Thickness(0), Cursor = System.Windows.Input.Cursors.Hand,
                    ToolTip = "Remove this edge",
                };
                removeBtn.Click += (_, __) => RemoveEdges(new[] { edgeCopy });
                Grid.SetColumn(removeBtn, 2);
                row.Children.Add(removeBtn);
                holdsSection.Children.Add(new Border
                {
                    Background = InsCardBg, BorderBrush = InsBorder1, BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(5), Padding = new Thickness(6, 4, 6, 4), Margin = new Thickness(0, 3, 0, 0),
                    Child = row,
                });
            }
            AddSection(holdsSection);

            var removeAllBtn = new Button
            {
                Height = 26, FontSize = 10.5, FontWeight = FontWeights.Bold, FontFamily = InsUiFont,
                Background = InsRedBg, BorderBrush = InsRedBorder, Foreground = InsRed, BorderThickness = new Thickness(1),
                Cursor = System.Windows.Input.Cursors.Hand,
                Content = HRow(6, InsIconEl("trash-2", 11, InsRed), InsText(one ? "Remove edge" : $"Remove all {edges.Count} edges", 10.5, InsRed, FontWeights.Bold)),
            };
            var edgesCopy = edges.ToList();
            removeAllBtn.Click += (_, __) => RemoveEdges(edgesCopy);
            AddSection(removeAllBtn);

            AddSection(InsText("Removing a §5.2 edge opens a gap in the chain. The header pill shows the count; Re-wire restores the pattern.",
                10, InsTextFaint));
        }

        // ── Mutations — real, in-memory ChainDoc writes; real GitHub persistence is #2481's job ──

        /// <summary>Common post-mutation refresh: re-derive, re-render canvas + top bar + inspector.
        /// Does not touch the status-strip hint — callers finish with <see cref="ShowConfirmation"/>.</summary>
        private void AfterDocMutation()
        {
            if (_doc == null) return;
            _derived = ChainRules.Derive(_doc);
            Canvas.Rerender();
            Render();
            RenderInspector();
        }

        /// <summary>README status-strip: "after an action, a one-line confirmation" — shown in the
        /// default (non-amber) hint color, replacing whatever <see cref="RenderStatusStrip"/> most
        /// recently set (e.g. via a selection change this same action triggered).</summary>
        private void ShowConfirmation(string text)
        {
            StatusHintText.Text = text;
            StatusHintText.Foreground = InsTextDim;
        }

        // ── Real GitHub persistence (Git #2481) ──────────────────────────────────────────────────

        /// <summary>
        /// Git #2481 — the persistence choke point every mutation funnels through. Called on the UI
        /// thread the instant after a mutation has re-derived + re-rendered: it captures the
        /// <b>after</b> snapshot synchronously (before the first <c>await</c>, so a later click can't
        /// race it), then diffs it against the <paramref name="before"/> the caller captured at its
        /// own entry, applies exactly the real GitHub writes that account for the difference
        /// (blocked_by edge add/remove + board-column moves), and re-reads each one back to audit it.
        /// The status-strip confirmation shows the real verified result, not an optimistic claim.
        /// </summary>
        private async void PersistThenConfirm(ChainSnapshot before, string confirmText)
        {
            var after = _doc != null ? ChainSnapshot.Capture(_doc) : null; // sync, on UI thread
            if (after == null || _client == null)
            {
                ShowConfirmation(confirmText + (_client == null ? "  (not saved — no GitHub client loaded)" : ""));
                return;
            }

            ShowConfirmation(confirmText + "  · saving to GitHub…");

            ChainPersistResult result;
            await _persistLock.WaitAsync();
            try
            {
                result = await ChainPersistence.PersistAndAuditAsync(_client, before, after);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Epic #{_epicNumber}: persist failed — {ex.Message}");
                ShowConfirmation(confirmText + $"  · ⚠ save failed: {ex.Message}");
                return;
            }
            finally { _persistLock.Release(); }

            ApplyPersistResult(confirmText, result);
        }

        /// <summary>The canvas "Add blocker…" link mode resolves inside <c>ChainCanvasControl</c> and
        /// hands us the exact new <c>(from,to)</c> — persist just that one real edge and audit it,
        /// no snapshot diff needed.</summary>
        private async void PersistSingleEdgeAdd(int from, int to)
        {
            if (_client == null)
            {
                ShowConfirmation($"#{to} is now blocked_by #{from}.  (not saved — no GitHub client loaded)");
                return;
            }
            ShowConfirmation($"#{to} is now blocked_by #{from}.  · saving to GitHub…");

            ChainPersistResult result;
            await _persistLock.WaitAsync();
            try
            {
                result = await ChainPersistence.PersistSingleEdgeAddAsync(_client, from, to);
            }
            catch (Exception ex)
            {
                ActivityLog.Log(Channel, $"Epic #{_epicNumber}: persist failed — {ex.Message}");
                ShowConfirmation($"#{to} is now blocked_by #{from}.  · ⚠ save failed: {ex.Message}");
                return;
            }
            finally { _persistLock.Release(); }

            ApplyPersistResult($"#{to} is now blocked_by #{from}.", result);
        }

        /// <summary>Folds a real persist+audit result back into the status-strip confirmation and the
        /// ActivityLog. A no-op diff keeps the plain confirmation (some mutations are visual-only,
        /// e.g. a reorder whose gate pairs didn't actually change).</summary>
        private void ApplyPersistResult(string confirmText, ChainPersistResult result)
        {
            if (result.NothingToDo)
            {
                ShowConfirmation(confirmText);
                return;
            }

            ActivityLog.Log(Channel, $"Epic #{_epicNumber}: {confirmText}");
            foreach (var line in result.LogLines())
                ActivityLog.Log(Channel, line);

            ShowConfirmation($"{confirmText}  · {result.ShortSummary()}");
        }

        /// <summary>§5.3 manual gate toggle — ported 1:1 from the reference's <c>toggleGate</c>.</summary>
        private void ToggleManualGate(string featureId)
        {
            if (_doc == null) return;
            var feature = ChainRules.FindFeature(_doc, featureId);
            if (feature == null) return;
            var before = ChainSnapshot.Capture(_doc);
            bool on = !(_doc.Gates.TryGetValue(featureId, out var g) && g);
            _doc.Gates[featureId] = on;
            int moved = 0;
            foreach (var issue in feature.Issues)
            {
                if (on && issue.Status == ChainStatus.Batter) { issue.Status = ChainStatus.Backlog; moved++; }
                else if (!on && issue.Status == ChainStatus.Backlog) { issue.Status = ChainStatus.Batter; moved++; }
            }
            string n = $"{moved} issue{(moved == 1 ? "" : "s")}";
            AfterDocMutation();
            PersistThenConfirm(before, on
                ? $"Manual gate before {feature.Name}: {n} moved to Backlog. The blocked_by edges stay as the technical floor."
                : $"Gate before {feature.Name} is automatic: {n} moved to Batter Up.");
        }

        /// <summary>Sentinel change — ported 1:1 from the reference's <c>makeSentinel</c>, shared by
        /// both the Feature view's sentinel &lt;select&gt; and the Issue view's "Make this the
        /// sentinel" button (same underlying call in the reference too).</summary>
        private void MakeSentinel(int num)
        {
            if (_doc == null) return;
            var feature = ChainRules.FeatureOf(_doc, num);
            var issue = ChainRules.FindIssue(_doc, num);
            if (feature == null || issue == null) return;
            if (issue.Status == ChainStatus.Ask)
            {
                ShowConfirmation("An Ask Shane item sits outside the cascade and cannot be the sentinel.");
                return;
            }
            if (feature.Sentinel == num) return;

            var before = ChainSnapshot.Capture(_doc);
            bool wasIssueSelected = Canvas.SelectedIssueNum != null;
            feature.Sentinel = num;
            ChainRules.RechainFanin(_doc, feature);
            ChainRules.RechainGates(_doc);
            AfterDocMutation();
            if (wasIssueSelected) Canvas.SelectIssue(num, ensureExpanded: true);
            PersistThenConfirm(before, $"#{num} is now the sentinel of {feature.Name}. Fan-in and the downstream gate were re-wired.");
        }

        /// <summary>Priority reorder — the reference's <c>reorder(from, to)</c> ported verbatim
        /// (README "Interactions": "Drag a Feature header onto another … dragged Feature takes the
        /// drop target's index"). A <b>splice</b>, not a swap: remove the dragged Feature from its
        /// slot, then insert it at the drop target's original index — identical to a swap only for
        /// the adjacent case, so the non-adjacent drag path genuinely needs this. Then every
        /// <c>gate</c> edge is regenerated for the new order (§5.2 step 3); <c>fanin</c> and
        /// user-added <c>manual</c> edges are kept (<see cref="ChainRules.RechainGates"/> only
        /// touches gate edges). Selects the moved Feature and posts the reference's own note. Shared
        /// by the canvas drag (<c>Canvas.FeatureReordered</c>) and the inspector reorder arrows
        /// (<see cref="MoveFeature"/>).</summary>
        private void ReorderFeature(string fromId, string toId)
        {
            if (_doc == null || fromId == toId) return;
            int fi = _doc.Order.IndexOf(fromId);
            int ti = _doc.Order.IndexOf(toId);
            if (fi < 0 || ti < 0) return;
            var before = ChainSnapshot.Capture(_doc);
            _doc.Order.RemoveAt(fi);
            _doc.Order.Insert(ti, fromId);
            ChainRules.RechainGates(_doc);
            AfterDocMutation();
            Canvas.SelectFeature(fromId);
            // The gate blocked_by edges persist; the sub-issue priority ORDER itself has no write
            // primitive in the three named write types (see #2481 findings) — flagged in the note.
            PersistThenConfirm(before, "Priority changed. Cross-feature gates re-wired per §5.2 (blocked_by edges persist; the column order itself is local until GitHub sub-issue reordering lands).");
        }

        /// <summary>Reorder by one step — README "Inspector ← / →". Ported 1:1 from the reference's
        /// <c>moveFeature(fid, dir)</c>, which itself just calls <c>reorder(fid, order[i+dir])</c>,
        /// so this shares the exact same splice + gate-rewire path as the drag.</summary>
        private void MoveFeature(string featureId, int dir)
        {
            if (_doc == null) return;
            int i = _doc.Order.IndexOf(featureId);
            int j = i + dir;
            if (i < 0 || j < 0 || j >= _doc.Order.Count) return;
            ReorderFeature(featureId, _doc.Order[j]);
        }

        /// <summary>Board status change — ported 1:1 from the reference's <c>setStatus</c>: entering
        /// or leaving Ask Shane drops/rewires the issue's fan-in and gate edges (it leaves/rejoins
        /// the cascade); any other transition leaves edges untouched.</summary>
        private void SetIssueStatus(int num, ChainStatus newStatus)
        {
            if (_doc == null) return;
            var issue = ChainRules.FindIssue(_doc, num);
            var feature = ChainRules.FeatureOf(_doc, num);
            if (issue == null || feature == null) return;
            var was = issue.Status;
            if (was == newStatus) return;
            var before = ChainSnapshot.Capture(_doc);
            issue.Status = newStatus;
            string note = $"#{num} → {InsStatusLabel(newStatus)}.";
            if ((was == ChainStatus.Ask) != (newStatus == ChainStatus.Ask))
            {
                ChainRules.RechainFanin(_doc, feature);
                ChainRules.RechainGates(_doc);
                note += newStatus == ChainStatus.Ask
                    ? " Left the cascade: its fan-in and gate edges were dropped."
                    : " Joined the cascade: fan-in and gate edges wired.";
            }
            else if (newStatus == ChainStatus.Done && feature.Sentinel == num)
            {
                note += " Sentinel cleared — the next Feature is released.";
            }
            AfterDocMutation();
            PersistThenConfirm(before, note);
        }

        /// <summary>Removes real edges from the document — ported 1:1 from the reference's
        /// <c>removeEdges</c>, used by every "x" row button, "Remove edge"/"Remove all N edges",
        /// and the <c>Delete</c>/<c>Backspace</c> shortcut. Re-selects whatever real pairs of the
        /// current edge selection survive, or clears selection entirely if none do.</summary>
        private void RemoveEdges(IReadOnlyList<ChainEdge> edgesToRemove)
        {
            if (_doc == null || edgesToRemove.Count == 0) return;
            var before = ChainSnapshot.Capture(_doc);
            var pairs = new HashSet<(int From, int To)>(edgesToRemove.Select(e => (e.From, e.To)));
            _doc.Edges.RemoveAll(e => pairs.Contains((e.From, e.To)));
            AfterDocMutation();

            var remaining = Canvas.SelectedEdges;
            if (remaining.Count > 0)
                Canvas.SelectEdgeBundle(remaining.Select(e => (e.From, e.To)));
            else
                Canvas.ClearEdgeSelection();

            PersistThenConfirm(before, edgesToRemove.Count == 1
                ? $"Removed: #{edgesToRemove[0].To} blocked_by #{edgesToRemove[0].From}."
                : $"Removed {edgesToRemove.Count} blocked_by edges.");
        }

        /// <summary>"Add blocker…" / "Cancel" — README link mode entry point. The actual pick (click
        /// on another issue node) and the resulting edge write live in
        /// <c>ChainCanvasControl.OnNodeClicked</c>; this just toggles the mode.</summary>
        private void ToggleLinkMode(int targetNum)
        {
            if (Canvas.LinkModeTargetIssue == targetNum) Canvas.CancelLinkMode();
            else Canvas.EnterLinkMode(targetNum);
        }

        // ── Local UI factory helpers (README "Design tokens" — Segoe UI substitutes Inter per
        // this window's own XAML header comment; Consolas substitutes the mono stack) ──────────

        private void AddSection(FrameworkElement el)
        {
            el.Margin = new Thickness(el.Margin.Left, el.Margin.Top, el.Margin.Right, Math.Max(el.Margin.Bottom, 0) + 12);
            InspectorHost.Children.Add(el);
        }

        private static StackPanel InsColumn(params FrameworkElement[] items)
        {
            var panel = new StackPanel();
            foreach (var item in items) panel.Children.Add(item);
            return panel;
        }

        private static FrameworkElement Pad(FrameworkElement el, Thickness margin) { el.Margin = margin; return el; }

        private static Grid HRow(double gap, params FrameworkElement[] items)
        {
            var grid = new Grid();
            for (int i = 0; i < items.Length; i++)
            {
                bool isSpacer = items[i] is FrameworkElement { Tag: "spacer" };
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = isSpacer ? new GridLength(1, GridUnitType.Star) : GridLength.Auto });
                if (i > 0 && !isSpacer) items[i].Margin = new Thickness(items[i].Margin.Left + gap, items[i].Margin.Top, items[i].Margin.Right, items[i].Margin.Bottom);
                items[i].VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(items[i], i);
                grid.Children.Add(items[i]);
            }
            return grid;
        }

        private static FrameworkElement InsSpacer() => new Border { Tag = "spacer" };

        private static TextBlock InsText(string text, double size, Brush color, FontWeight? weight = null, Thickness? margin = null)
        {
            return new TextBlock
            {
                Text = text, FontFamily = InsUiFont, FontSize = size, FontWeight = weight ?? FontWeights.Normal,
                Foreground = color, TextWrapping = TextWrapping.Wrap, Margin = margin ?? new Thickness(0),
            };
        }

        private static TextBlock InsMono(string text, double size, Brush color, FontWeight? weight = null, Thickness? margin = null)
        {
            var tb = InsText(text, size, color, weight, margin);
            tb.FontFamily = InsMonoFont;
            tb.TextWrapping = TextWrapping.NoWrap;
            return tb;
        }

        private static TextBlock InsEyebrow(string text, double size = 9, Thickness? margin = null) =>
            InsText(text.ToUpperInvariant(), size, InsTextFaint, FontWeights.ExtraBold, margin);

        private static Border InsBadge(string text) => new()
        {
            Background = InsBlueFill, CornerRadius = new CornerRadius(4), Padding = new Thickness(5, 1, 5, 1),
            Child = InsMono(text, 8.5, InsBlueLight, FontWeights.ExtraBold),
        };

        private static FrameworkElement InsIconEl(string name, double size, Brush stroke)
        {
            var path = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse(InsIconPaths[name]), Stroke = stroke, StrokeThickness = 2,
                StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round,
            };
            var canvas = new System.Windows.Controls.Canvas { Width = 24, Height = 24 };
            canvas.Children.Add(path);
            return new Viewbox { Width = size, Height = size, Child = canvas };
        }

        private static Border InsCard(FrameworkElement content, Brush fill, Brush border, Brush? leftAccent = null, bool dashed = false)
        {
            var b = new Border
            {
                Background = fill, BorderBrush = border, BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(7), Padding = new Thickness(12, 11, 12, 11), Child = content,
            };
            if (dashed) b.BorderThickness = new Thickness(1); // dash pattern isn't a Border property; approximate with a solid muted border.
            if (leftAccent != null)
            {
                var grid = new Grid();
                var accent = new Rectangle { Width = 2, Fill = leftAccent, HorizontalAlignment = HorizontalAlignment.Left };
                grid.Children.Add(accent);
                content.Margin = new Thickness(6, 0, 0, 0);
                grid.Children.Add(content);
                b.Child = grid;
            }
            return b;
        }

        private static Button InsPrimaryButton(string text) => new()
        {
            Content = text, Height = 26, FontSize = 10.5, FontWeight = FontWeights.Bold, FontFamily = InsUiFont,
            Background = InsBlueFill, BorderBrush = InsBlueBorder, Foreground = InsBlueLighter, BorderThickness = new Thickness(1),
            Cursor = System.Windows.Input.Cursors.Hand,
        };

        private static Button InsIconButton(string icon, string tooltip) => new()
        {
            Content = InsIconEl(icon, 12, InsTextMid), Width = 30, Height = 26,
            Background = InsCardBg, BorderBrush = InsBorder2, BorderThickness = new Thickness(1),
            Cursor = System.Windows.Input.Cursors.Hand, ToolTip = tooltip,
        };

        /// <summary>The 30x16 gate switch (README "30×16 switch"): a Border track + a Border knob
        /// positioned via Margin, since WPF's stock ToggleButton/CheckBox chrome can't reproduce the
        /// exact pill shape without a full template — this is a plain, clickable visual instead.</summary>
        private static Border InsSwitch(bool on)
        {
            var knob = new Border
            {
                Width = 12, Height = 12, CornerRadius = new CornerRadius(99),
                Background = on ? InsAmber : InsAmberKnobOff,
                HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(on ? 15 : 1, 0, 0, 0),
            };
            return new Border
            {
                Width = 30, Height = 16, CornerRadius = new CornerRadius(99),
                Background = on ? InsAmberBg : InsFrozen("#21262d"),
                BorderBrush = on ? InsAmberBorder : InsBorder3, BorderThickness = new Thickness(1),
                Child = knob,
            };
        }

        private static Ellipse InsStateDot(ChainNodeState state, double size = 8)
        {
            var dot = new Ellipse { Width = size, Height = size };
            switch (state)
            {
                case ChainNodeState.Ready: dot.Fill = InsGreen; break;
                case ChainNodeState.Blocked: dot.Stroke = InsBlue; dot.StrokeThickness = 1.5; break;
                case ChainNodeState.Held: dot.Stroke = InsHeldDot; dot.StrokeThickness = 1.5; dot.StrokeDashArray = new DoubleCollection { 1.5, 1.5 }; break;
                case ChainNodeState.Ask: dot.Fill = InsVioletDim; break;
                default: dot.Fill = InsGreenDark; dot.Stroke = InsGreen; dot.StrokeThickness = 1; break;
            }
            return dot;
        }

        private static string InsStateLabel(ChainNodeState state) => state switch
        {
            ChainNodeState.Ready => "ready",
            ChainNodeState.Blocked => "waits",
            ChainNodeState.Held => "held",
            ChainNodeState.Ask => "ask",
            _ => "done",
        };

        private static Brush InsStateColor(ChainNodeState state) => state switch
        {
            ChainNodeState.Ready => InsGreen,
            ChainNodeState.Blocked => InsBlueSoft,
            ChainNodeState.Held => InsTextDim,
            ChainNodeState.Ask => InsViolet,
            _ => InsGreenDim,
        };

        private static string InsStatusLabel(ChainStatus status) => status switch
        {
            ChainStatus.Batter => "Batter Up",
            ChainStatus.Backlog => "Backlog",
            ChainStatus.Ask => "Ask Shane",
            _ => "Done",
        };

        private static SolidColorBrush InsFrozen(string hex)
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            brush.Freeze();
            return brush;
        }
    }
}

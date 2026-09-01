using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole
{
    /// <summary>
    /// Git #2110 — Dynamic Build Queue Map, Phase 2 (real-time visual rendering).
    ///
    /// A live, floaty visual map of the build queue, built entirely on Phase 1's (#2109)
    /// real data layer: <see cref="BuildQueuePostgresClient.GetQueueMapAsync"/> returns a
    /// <see cref="BuildQueueMap"/> snapshot — per-item live-checked blockers, genuine
    /// deadlock cycles, error classification, and real age — and this window renders it.
    ///
    /// Rendering (all in code-behind from the live snapshot, no fixture data):
    ///   • Every queue item is a NODE card, laid out left→right by dependency depth so the
    ///     things a build waits on sit upstream (to its left).
    ///   • Blocker relationships between two queued builds are CONNECTOR LINES between the
    ///     nodes: amber = still blocking, faint green = cleared.
    ///   • Genuine deadlock CYCLES are flagged unmissably — a loud red top banner naming
    ///     the loop AND dashed-red loop edges + a "DEADLOCK" node badge — not just a chain
    ///     that happens to close on itself.
    ///   • ERROR/crashed/limit-paused items are visually distinct (red/orange accent +
    ///     an explicit badge) from healthy queued/running items.
    ///   • Real per-item AGE (time in current state) is shown on every node.
    ///
    /// Basic/default styling for now — real Design output for this panel area is still
    /// pending; ship functional, reskin later, per tonight's established pattern.
    /// </summary>
    public partial class BuildQueueMapWindow : Window
    {
        private readonly BuildQueuePostgresClient? _db;
        private readonly DispatcherTimer _timer;
        private bool _busy;

        // ── Layout constants (fixed node geometry so line endpoints are deterministic
        //    without a WPF measure pass — good enough for the "basic styling now" bar). ──
        private const double NodeWidth  = 250;
        private const double NodeHeight = 108;
        private const double ColStride  = 330;   // horizontal spacing per dependency depth
        private const double RowStride  = 132;    // vertical spacing per node within a column
        private const double Pad        = 24;     // canvas outer margin

        public BuildQueueMapWindow(BuildQueuePostgresClient? db)
        {
            // Git #2169 — must be assigned BEFORE InitializeComponent(): the XAML sets
            // AutoRefreshToggle IsChecked="True", which fires AutoRefreshToggle_Changed
            // (and thus _timer.Start()) synchronously during InitializeComponent().
            // 6s — each pass reuses GetNextAsync's live gh open-issue snapshot when there
            // are blockers to check, so keep the cadence considerate rather than hammering.
            _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
            _timer.Tick += async (_, __) => await RefreshAsync();

            InitializeComponent();
            _db = db;

            Loaded += async (_, __) =>
            {
                BuildLegend();
                await RefreshAsync();
                if (AutoRefreshToggle.IsChecked == true) _timer.Start();
            };
            Closed += (_, __) => _timer.Stop();
        }

        private void AutoRefreshToggle_Changed(object sender, RoutedEventArgs e)
        {
            if (AutoRefreshToggle.IsChecked == true) _timer.Start();
            else _timer.Stop();
        }

        private async void BtnRefresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

        // ── Live pull ─────────────────────────────────────────────────────────────────
        private async Task RefreshAsync()
        {
            if (_busy) return;              // never overlap a slow gh/DB pass with the next tick
            if (_db == null)
            {
                ShowEmpty("Not connected to the build queue database — see Settings.");
                SummaryText.Text = "Not connected.";
                return;
            }

            _busy = true;
            try
            {
                var map = await _db.GetQueueMapAsync();
                Render(map);
            }
            catch (Exception ex)
            {
                ShowEmpty("Couldn't load the queue map: " + ex.Message);
                SummaryText.Text = "Error loading queue map.";
                ActivityLog.Log("build-queue-map", "refresh failed: " + ex.Message);
            }
            finally
            {
                _busy = false;
            }
        }

        // ── Render one snapshot ─────────────────────────────────────────────────────────
        private void Render(BuildQueueMap map)
        {
            MapCanvas.Children.Clear();

            GeneratedText.Text = "Updated " + map.GeneratedAt.ToLocalTime().ToString("HH:mm:ss");

            var items = map.Items.ToList();

            // Summary counts.
            int blocked = items.Count(i => i.IsBlocked);
            int errored = items.Count(i => i.IsError);
            int running = items.Count(i => string.Equals(i.Status, "running", StringComparison.OrdinalIgnoreCase));
            SummaryText.Text =
                $"{items.Count} item(s)  ·  {running} running  ·  {blocked} blocked  ·  {errored} error(s)  ·  {map.Cycles.Count} deadlock(s)";

            // Deadlock banner — unmissable call-out for genuine cycles.
            if (map.HasCycles)
            {
                DeadlockText.Text = "DEADLOCK — " + map.Cycles.Count + " dependency loop(s) detected: " +
                    string.Join("   ·   ", map.Cycles.Select(c =>
                        c.IssueNumbers.Count == 1
                            ? $"#{c.IssueNumbers[0]} waits on itself"
                            : string.Join(" → ", c.IssueNumbers.Select(n => "#" + n)) + " → #" + c.IssueNumbers[0]));
                DeadlockBanner.Visibility = Visibility.Visible;
            }
            else
            {
                DeadlockBanner.Visibility = Visibility.Collapsed;
            }

            // Blocker-state unverified (GitHub unreachable this pass).
            if (!map.BlockerCheckReachedGitHub)
            {
                UnverifiedText.Text = "Blocker state unverified — GitHub was unreachable this pass" +
                    (string.IsNullOrWhiteSpace(map.BlockerCheckError) ? "" : " (" + map.BlockerCheckError + ")") +
                    ". Every blocker is shown as still-blocking (fail-closed).";
                UnverifiedBanner.Visibility = Visibility.Visible;
            }
            else
            {
                UnverifiedBanner.Visibility = Visibility.Collapsed;
            }

            if (items.Count == 0)
            {
                ShowEmpty("The build queue is empty — nothing running, queued, or recently failed.");
                MapCanvas.Width = 0;
                MapCanvas.Height = 0;
                return;
            }
            EmptyOverlay.Visibility = Visibility.Collapsed;

            var byId = items.ToDictionary(i => i.Id);

            // ── Depth per item (dependency layer). Only edges to OTHER queued builds count,
            //    and same-cycle edges are excluded so a genuine loop can't make layering
            //    recurse forever — the loop is still drawn distinctly below. ──
            var depth = new Dictionary<int, int>();
            var onPath = new HashSet<int>();
            int Depth(BuildQueueMapItem it)
            {
                if (depth.TryGetValue(it.Id, out var d)) return d;
                if (!onPath.Add(it.Id)) return 0;   // defensive guard against any residual cycle
                int best = 0;
                foreach (var b in it.Blockers)
                {
                    if (b.BlockingQueueItemId is not int bid || bid == it.Id) continue;
                    if (!byId.TryGetValue(bid, out var blk)) continue;
                    if (it.CycleId != null && it.CycleId == blk.CycleId) continue; // skip loop edge
                    best = Math.Max(best, Depth(blk) + 1);
                }
                onPath.Remove(it.Id);
                depth[it.Id] = best;
                return best;
            }
            foreach (var it in items) Depth(it);

            // ── Assign positions: column = depth, row = order within that column. ──
            var rects = new Dictionary<int, Rect>();
            var rowCursor = new Dictionary<int, int>();
            int maxDepth = 0;
            foreach (var it in items) // items are already ordered oldest-first from the query
            {
                int col = depth[it.Id];
                maxDepth = Math.Max(maxDepth, col);
                int row = rowCursor.TryGetValue(col, out var r) ? r : 0;
                rowCursor[col] = row + 1;

                double x = Pad + col * ColStride;
                double y = Pad + row * RowStride;
                rects[it.Id] = new Rect(x, y, NodeWidth, NodeHeight);
            }

            // ── Connector lines first (drawn behind the node cards). ──
            foreach (var it in items)
            {
                if (!rects.TryGetValue(it.Id, out var sRect)) continue;
                foreach (var b in it.Blockers)
                {
                    if (b.BlockingQueueItemId is not int bid || bid == it.Id) continue;
                    if (!rects.TryGetValue(bid, out var tRect)) continue;
                    if (!byId.TryGetValue(bid, out var blk)) continue;

                    bool sameCycle = it.CycleId != null && it.CycleId == blk.CycleId;
                    DrawEdge(sRect, tRect, sameCycle, b.StillBlocking);
                }
            }

            // ── Node cards on top. ──
            foreach (var it in items)
            {
                var rect = rects[it.Id];
                var card = BuildNodeCard(it);
                Canvas.SetLeft(card, rect.X);
                Canvas.SetTop(card, rect.Y);
                MapCanvas.Children.Add(card);
            }

            // Size the canvas to fit everything.
            int deepestRows = rowCursor.Count == 0 ? 0 : rowCursor.Values.Max();
            MapCanvas.Width  = Pad * 2 + (maxDepth + 1) * ColStride;
            MapCanvas.Height = Pad * 2 + Math.Max(1, deepestRows) * RowStride;
        }

        // ── One node card ──────────────────────────────────────────────────────────────
        private Border BuildNodeCard(BuildQueueMapItem it)
        {
            var accent = AccentFor(it);

            var card = new Border
            {
                Width = NodeWidth,
                Height = NodeHeight,
                Background = Brush("CardBackgroundBrush") ?? Brush("Surface0Brush"),
                BorderBrush = accent,
                BorderThickness = new Thickness(it.IsError || it.IsInCycle ? 2 : 1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(9, 7, 9, 7),
                ToolTip = BuildTooltip(it),
            };

            var stack = new StackPanel();

            // Row 1 — id + status chip.
            var row1 = new DockPanel { LastChildFill = false };
            var idText = new TextBlock
            {
                Text = it.GithubNumber is int g && g > 0 ? "#" + g : "Build " + it.Id,
                FontSize = 13,
                FontWeight = FontWeights.SemiBold,
                Foreground = accent,
                VerticalAlignment = VerticalAlignment.Center,
            };
            DockPanel.SetDock(idText, Dock.Left);
            row1.Children.Add(idText);

            var chip = MakeChip(StatusChipText(it), accent);
            DockPanel.SetDock(chip, Dock.Right);
            row1.Children.Add(chip);
            stack.Children.Add(row1);

            // Row 2 — title.
            stack.Children.Add(new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(it.Title) ? "(untitled)" : it.Title,
                FontSize = 11.5,
                Foreground = Brush("TextBrush"),
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                Margin = new Thickness(0, 3, 0, 0),
            });

            // Row 3 — age / current-state.
            stack.Children.Add(new TextBlock
            {
                Text = it.CurrentStateLabel + " · " + FormatAge(it.Age) +
                       (it.TotalAge is TimeSpan ta && it.Age is TimeSpan a && ta - a > TimeSpan.FromMinutes(1)
                            ? "  (in queue " + FormatAge(it.TotalAge) + ")" : ""),
                FontSize = 10.5,
                Foreground = Brush("Subtext0Brush"),
                Margin = new Thickness(0, 3, 0, 0),
                TextTrimming = TextTrimming.CharacterEllipsis,
            });

            // Row 4 — badges (deadlock / error / waiting-on).
            var badges = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
            if (it.IsInCycle)
                badges.Children.Add(MakeChip("DEADLOCK", Brush("RedBrush")));
            if (it.IsError)
                badges.Children.Add(MakeChip(ErrorLabel(it.ErrorKind), Brush("RedBrush")));
            var unresolved = it.UnresolvedBlockers;
            if (unresolved.Count > 0)
            {
                var wait = "waiting on " + string.Join(" ", unresolved.Take(3).Select(b => "#" + b.Number)) +
                           (unresolved.Count > 3 ? " +" + (unresolved.Count - 3) : "");
                badges.Children.Add(MakeChip(wait, Brush("YellowBrush")));
            }
            if (badges.Children.Count > 0)
                stack.Children.Add(badges);

            card.Child = stack;
            return card;
        }

        private Border MakeChip(string text, Brush? fg)
        {
            return new Border
            {
                Background = Brush("Surface0Brush"),
                CornerRadius = new CornerRadius(3),
                Padding = new Thickness(5, 1, 5, 1),
                Margin = new Thickness(0, 0, 4, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = text,
                    FontSize = 9.5,
                    FontWeight = FontWeights.SemiBold,
                    Foreground = fg ?? Brush("Subtext1Brush"),
                },
            };
        }

        // ── One connector line between two node rects ────────────────────────────────────
        private void DrawEdge(Rect sRect, Rect tRect, bool deadlock, bool stillBlocking)
        {
            var (from, to) = Anchor(sRect, tRect);

            Brush stroke = deadlock ? (Brush("RedBrush") ?? Brushes.Red)
                          : stillBlocking ? (Brush("YellowBrush") ?? Brushes.Goldenrod)
                          : (Brush("Surface2Brush") ?? Brushes.Gray);

            var line = new Line
            {
                X1 = from.X, Y1 = from.Y,
                X2 = to.X,   Y2 = to.Y,
                Stroke = stroke,
                StrokeThickness = deadlock ? 2.4 : 1.6,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeStartLineCap = PenLineCap.Round,
                SnapsToDevicePixels = true,
            };
            if (deadlock)
                line.StrokeDashArray = new DoubleCollection { 3, 3 };
            else if (!stillBlocking)
                line.Opacity = 0.55;
            MapCanvas.Children.Add(line);

            // Small arrowhead at the target (the thing being waited on), for non-loop edges.
            if (!deadlock)
                MapCanvas.Children.Add(MakeArrowhead(from, to, stroke));
        }

        private Polygon MakeArrowhead(Point from, Point to, Brush fill)
        {
            var dir = to - from;
            double len = Math.Max(dir.Length, 0.001);
            var ux = dir.X / len;
            var uy = dir.Y / len;
            const double size = 7;
            // Two base points perpendicular to the direction, set back from the tip.
            var baseCenter = new Point(to.X - ux * size, to.Y - uy * size);
            var perpX = -uy;
            var perpY = ux;
            var p1 = new Point(baseCenter.X + perpX * (size * 0.5), baseCenter.Y + perpY * (size * 0.5));
            var p2 = new Point(baseCenter.X - perpX * (size * 0.5), baseCenter.Y - perpY * (size * 0.5));
            return new Polygon
            {
                Points = new PointCollection { to, p1, p2 },
                Fill = fill,
                Opacity = 0.8,
            };
        }

        /// <summary>Anchor a segment on the facing edges of the two node rects, choosing the
        /// dominant axis so mostly-horizontal (layered) edges leave/enter the left/right sides
        /// and vertical edges the top/bottom.</summary>
        private static (Point from, Point to) Anchor(Rect s, Rect t)
        {
            double sx = s.X + s.Width / 2, sy = s.Y + s.Height / 2;
            double tx = t.X + t.Width / 2, ty = t.Y + t.Height / 2;
            double dx = tx - sx, dy = ty - sy;

            if (Math.Abs(dx) >= Math.Abs(dy))
            {
                var fromP = new Point(dx >= 0 ? s.Right : s.Left, sy);
                var toP   = new Point(dx >= 0 ? t.Left : t.Right, ty);
                return (fromP, toP);
            }
            else
            {
                var fromP = new Point(sx, dy >= 0 ? s.Bottom : s.Top);
                var toP   = new Point(tx, dy >= 0 ? t.Top : t.Bottom);
                return (fromP, toP);
            }
        }

        // ── Styling helpers ──────────────────────────────────────────────────────────────
        private Brush AccentFor(BuildQueueMapItem it)
        {
            if (it.IsInCycle) return Brush("RedBrush") ?? Brushes.Red;
            if (it.IsError)
                return it.ErrorKind == QueueMapErrorKind.SessionLimit
                    ? (Brush("PeachBrush") ?? Brushes.Orange)
                    : (Brush("RedBrush") ?? Brushes.Red);
            var s = it.Status ?? "";
            if (string.Equals(s, "running", StringComparison.OrdinalIgnoreCase)) return Brush("GreenBrush") ?? Brushes.LightGreen;
            if (string.Equals(s, BuildQueuePostgresClient.VerifyingStatus, StringComparison.OrdinalIgnoreCase)) return Brush("TealBrush") ?? Brushes.Teal;
            if (it.IsBlocked) return Brush("YellowBrush") ?? Brushes.Goldenrod;
            return Brush("BlueBrush") ?? Brushes.CornflowerBlue;
        }

        private static string StatusChipText(BuildQueueMapItem it)
        {
            if (it.IsError) return ErrorLabel(it.ErrorKind);
            if (string.Equals(it.Status, "running", StringComparison.OrdinalIgnoreCase)) return "RUNNING";
            if (string.Equals(it.Status, BuildQueuePostgresClient.VerifyingStatus, StringComparison.OrdinalIgnoreCase)) return "VERIFYING";
            if (it.IsBlocked) return "BLOCKED";
            return (it.CurrentStateLabel ?? it.Status ?? "queued").ToUpperInvariant();
        }

        private static string ErrorLabel(QueueMapErrorKind kind) => kind switch
        {
            QueueMapErrorKind.Failed => "FAILED",
            QueueMapErrorKind.OrphanedByRestart => "CRASHED",
            QueueMapErrorKind.SessionLimit => "LIMIT-PAUSED",
            _ => "ERROR",
        };

        private static string FormatAge(TimeSpan? age)
        {
            if (age is not TimeSpan t) return "—";
            if (t < TimeSpan.Zero) t = TimeSpan.Zero;
            if (t.TotalDays >= 1) return $"{(int)t.TotalDays}d {t.Hours}h";
            if (t.TotalHours >= 1) return $"{(int)t.TotalHours}h {t.Minutes}m";
            if (t.TotalMinutes >= 1) return $"{(int)t.TotalMinutes}m";
            return $"{(int)t.TotalSeconds}s";
        }

        private static string BuildTooltip(BuildQueueMapItem it)
        {
            var lines = new List<string>
            {
                (it.GithubNumber is int g && g > 0 ? "#" + g : "Build " + it.Id) + " — " + it.Title,
                "State: " + it.CurrentStateLabel + "  (status=" + it.Status +
                    (it.ExitCode is int ec ? ", exit=" + ec : "") + ")",
                "Age in state: " + FormatAge(it.Age) + "   ·   In queue: " + FormatAge(it.TotalAge),
            };
            if (it.IsInCycle) lines.Add("⚠ In a dependency deadlock cycle (id " + it.CycleId + ")");
            if (it.IsError) lines.Add("⚠ Error: " + ErrorLabel(it.ErrorKind));
            if (it.Blockers.Count > 0)
                lines.Add("Blockers: " + string.Join(", ", it.Blockers.Select(b =>
                    "#" + b.Number + (b.StillBlocking ? " (open)" : " (cleared)") + (b.IsQueueItem ? " [queued]" : ""))));
            return string.Join("\n", lines);
        }

        private void ShowEmpty(string message)
        {
            EmptyOverlay.Text = message;
            EmptyOverlay.Visibility = Visibility.Visible;
            MapCanvas.Children.Clear();
        }

        private void BuildLegend()
        {
            LegendPanel.Children.Clear();
            AddLegend(Brush("GreenBrush"),  "Running");
            AddLegend(Brush("BlueBrush"),   "Queued");
            AddLegend(Brush("YellowBrush"), "Blocked");
            AddLegend(Brush("TealBrush"),   "Verifying");
            AddLegend(Brush("RedBrush"),    "Error / Deadlock");
            AddLegend(Brush("PeachBrush"),  "Limit-paused");
        }

        private void AddLegend(Brush? swatch, string label)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 14, 0) };
            sp.Children.Add(new Rectangle
            {
                Width = 11, Height = 11,
                Fill = swatch ?? Brushes.Gray,
                RadiusX = 2, RadiusY = 2,
                Margin = new Thickness(0, 0, 5, 0),
                VerticalAlignment = VerticalAlignment.Center,
            });
            sp.Children.Add(new TextBlock
            {
                Text = label,
                FontSize = 10.5,
                Foreground = Brush("Subtext0Brush"),
                VerticalAlignment = VerticalAlignment.Center,
            });
            LegendPanel.Children.Add(sp);
        }

        private Brush? Brush(string key) => TryFindResource(key) as Brush;
    }
}

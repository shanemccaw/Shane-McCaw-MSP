// Git #3713 — measures BuildQueuePanel's new icon-rail indeterminate-spinner leak risk.
//
// Runs as its own process with its own offscreen window (same technique as
// scripts/probes/queue-card-leak). Never launches, attaches to, or drives BuildConsole, and
// doesn't host a real BuildQueuePanel. It compiles the REAL desktop/BuildConsole/Controls/
// KeyedCardPool.cs and KeyedSlotCardHost.cs and replicates exactly the one new animated element
// BuildRailIcon adds: a Running item with no real BuildProgressTracker data yet gets a genuinely
// indeterminate spinning ring (RotateTransform.Angle, Forever, registered via
// KeyedSlotCardHost.BeginOwnedAnimation) instead of a fake percentage. Items acquired through
// _railIcons (a KeyedCardPool) with a cache key of (hasProgress, percentBucket) — exactly
// RailIconCacheKey's own shape — so a spinner-carrying icon is reused as-is (clock keeps
// spinning, no restart-jank) across ticks where nothing about that item changed, and rebuilt
// (old icon retired, its clock stopped) the moment real progress data arrives or the item leaves
// the notable set entirely.
//
//   dotnet build -c Release
//   bin\Release\net8.0-windows\QueueIconRailLeakProbe.exe --seconds 120 --tickMs 50 --out results\x.json
//
// One tick = one RenderIconRail call (the real app calls this on every RenderQueue pass — see
// that method's own doc comment — so every ~5s local poll at minimum).
// Schedule (ticks): every 30, a random running item's progress arrives (spinner -> percent ring,
// old spinner clock must stop); every 70, a percent ring's percent advances a bucket (should NOT
// force a rebuild if it's still the same rounded percent, but does at a real bucket boundary);
// every 150, the oldest running item finishes and drops out of the notable set entirely (its
// element retired outright); every 90, a new running item with no progress data yet joins
// (a fresh spinner). Every 400 ticks, EVERY item finishes at once (Advance clears them all) — the
// rail should go fully empty and live spinner clocks should drop to exactly 0.
//
// Measured per sample:
//   expectedSpinners       items currently in the notable set with no real progress data (should
//                          be showing an indeterminate spinner right now).
//   estLiveSpinnerClocks   spinner clock invalidations / reference clock invalidations: the real
//                          number of still-ticking spinner clocks, independent of GC timing
//                          (StopOwnedAnimations calls Controller.Stop(), which halts a clock's
//                          own invalidation immediately — this does not need to wait for a GC).
//   iconsCreated / iconsRetired  running pool counters — every retirement must have stopped that
//                          icon's clock if it had one (see zeroClockOnEmptyRail below).
//   zeroClockOnEmptyRail   set only on the sample immediately after the every-400-ticks
//                          all-finish event: expected exactly 0 live spinner clocks.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using BuildConsole.Controls;
using Path = System.Windows.Shapes.Path;
using Rectangle = System.Windows.Shapes.Rectangle;

namespace QueueIconRailLeakProbe
{
    internal sealed class RailItem
    {
        public int Id;
        public bool HasProgress;
        public int PercentBucket;
    }

    internal sealed class Options
    {
        public double Seconds = 120;
        public int TickMs = 50;
        public int Items = 8;
        public double SampleSeconds = 5;
        public string Out = "result.json";

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                string v = args[i + 1];
                switch (args[i])
                {
                    case "--seconds": o.Seconds = double.Parse(v); break;
                    case "--tickMs": o.TickMs = int.Parse(v); break;
                    case "--items": o.Items = int.Parse(v); break;
                    case "--sampleSeconds": o.SampleSeconds = double.Parse(v); break;
                    case "--out": o.Out = v; break;
                    default: throw new ArgumentException($"unknown option {args[i]}");
                }
            }
            return o;
        }
    }

    internal static class Program
    {
        private static long _spinnerInvalidations;
        private static long _refInvalidations;
        private static long _iconsCreated;
        private static int _nextId = 1;
        private static readonly List<RailItem> Items = new();
        private static readonly List<Dictionary<string, object>> Samples = new();

        private static void OnSpinnerInvalidated(object? sender, EventArgs e) => Interlocked.Increment(ref _spinnerInvalidations);
        private static void OnRefInvalidated(object? sender, EventArgs e) => Interlocked.Increment(ref _refInvalidations);

        /// <summary>Same arc-geometry formula as BuildQueuePanel.BuildRingArcGeometry (0 = 12
        /// o'clock, sweeps clockwise). Exercised here at the same fixed 80° indeterminate-arc
        /// length BuildRailIcon uses, plus the real percent-ring boundary values (0.1, 50, 99.9)
        /// to confirm none of them throw or degenerate.</summary>
        private static Geometry BuildRingArcGeometry(Point center, double radius, double startAngleDeg, double sweepAngleDeg)
        {
            sweepAngleDeg = Math.Clamp(sweepAngleDeg, 0.1, 359.9);
            double startRad = (startAngleDeg - 90) * Math.PI / 180.0;
            double endRad = (startAngleDeg + sweepAngleDeg - 90) * Math.PI / 180.0;
            var startPoint = new Point(center.X + radius * Math.Cos(startRad), center.Y + radius * Math.Sin(startRad));
            var endPoint = new Point(center.X + radius * Math.Cos(endRad), center.Y + radius * Math.Sin(endRad));
            bool isLargeArc = sweepAngleDeg > 180;
            var figure = new PathFigure { StartPoint = startPoint, IsClosed = false };
            figure.Segments.Add(new ArcSegment(endPoint, new Size(radius, radius), 0, isLargeArc, SweepDirection.Clockwise, true));
            var geo = new PathGeometry();
            geo.Figures.Add(figure);
            return geo;
        }

        private static void SanityCheckArcGeometryEdgeCases()
        {
            var center = new Point(15, 15);
            foreach (double sweep in new[] { 0.0, 0.1, 50.0, 80.0, 180.0, 270.0, 359.9, 360.0, 720.0, -5.0 })
            {
                var geo = (PathGeometry)BuildRingArcGeometry(center, 13.5, 0, sweep);
                if (geo.Figures.Count != 1 || geo.Figures[0].Segments.Count != 1)
                    throw new InvalidOperationException($"degenerate arc geometry at sweep={sweep}");
            }
            Console.WriteLine("[probe] arc geometry edge-case sanity check passed (sweep 0..720, negative)");
        }

        /// <summary>Exact replica of BuildRailIcon's spinner branch: a Path ring with a
        /// RotateTransform driven by a Forever DoubleAnimation, registered as an owned clock on
        /// the container so KeyedCardPool retiring the container stops it.</summary>
        private static FrameworkElement BuildSpinnerIcon(RailItem item)
        {
            var container = new Grid { Width = 30, Height = 30 };
            var center = new Point(15, 15);
            var ring = new Path
            {
                Stroke = Brushes.DeepSkyBlue,
                StrokeThickness = 2.5,
                Data = BuildRingArcGeometry(center, 13.5, 0, 80)
            };
            var rotate = new RotateTransform(0, center.X, center.Y);
            ring.RenderTransform = rotate;
            var spin = new DoubleAnimation(0, 360, TimeSpan.FromSeconds(1.1)) { RepeatBehavior = RepeatBehavior.Forever };
            spin.CurrentTimeInvalidated += OnSpinnerInvalidated;
            KeyedSlotCardHost.BeginOwnedAnimation(container, rotate, RotateTransform.AngleProperty, spin);
            container.Children.Add(ring);
            Interlocked.Increment(ref _iconsCreated);
            return container;
        }

        /// <summary>Exact replica of BuildRailIcon's real-percentage branch: no owned clock at
        /// all — a static arc, redrawn only when RenderIconRail rebuilds it (percent bucket
        /// changed).</summary>
        private static FrameworkElement BuildPercentIcon(RailItem item)
        {
            var container = new Grid { Width = 30, Height = 30 };
            var center = new Point(15, 15);
            var ring = new Path
            {
                Stroke = Brushes.LimeGreen,
                StrokeThickness = 2.5,
                Data = BuildRingArcGeometry(center, 13.5, 0, Math.Min(item.PercentBucket, 99.9) / 100.0 * 360.0)
            };
            container.Children.Add(ring);
            Interlocked.Increment(ref _iconsCreated);
            return container;
        }

        private static void Seed(Options o)
        {
            for (int i = 0; i < o.Items; i++)
                Items.Add(new RailItem { Id = _nextId++, HasProgress = false });
        }

        private static readonly Random Rng = new(12345);

        /// <summary>Set for a stretch of ticks right after a full-clear event so a clean,
        /// uncluttered "everything just finished" window can actually be measured — with the
        /// normal churn (new spinners arriving every 90 ticks) left running, a full-clear tick is
        /// immediately followed by a fresh arrival before any sample window captures the true
        /// steady-state zero.</summary>
        private static int _quietUntilTick;

        private static void Advance(int t, Options o)
        {
            bool quiet = t < _quietUntilTick;
            if (!quiet && t > 0 && t % 30 == 0 && Items.Count > 0)
            {
                var spinner = Items.Where(i => !i.HasProgress).ToList();
                if (spinner.Count > 0)
                {
                    var it = spinner[Rng.Next(spinner.Count)];
                    it.HasProgress = true;
                    it.PercentBucket = 5;
                }
            }
            if (t > 0 && t % 70 == 0)
            {
                foreach (var it in Items.Where(i => i.HasProgress))
                    it.PercentBucket = Math.Min(99, it.PercentBucket + 7);
            }
            if (!quiet && t > 0 && t % 150 == 0)
            {
                var done = Items.Where(i => i.HasProgress).OrderBy(i => i.PercentBucket).FirstOrDefault();
                if (done != null) Items.Remove(done);
            }
            if (!quiet && t > 0 && t % 90 == 0)
                Items.Add(new RailItem { Id = _nextId++, HasProgress = false });
            if (t > 0 && t % 400 == 0)
            {
                Items.Clear(); // every notable build finished at once — the rail should go empty
                _quietUntilTick = t + 100; // ~2s of real quiet at the default 20ms tick, for a clean read
            }
        }

        [STAThread]
        private static int Main(string[] args)
        {
            var o = Options.Parse(args);
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(o.Out))!);
            SanityCheckArcGeometryEdgeCases();
            Seed(o);

            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            var host = new System.Windows.Controls.StackPanel();
            var win = new Window
            {
                Title = "QueueIconRailLeakProbe",
                Width = 200,
                Height = 600,
                WindowStartupLocation = WindowStartupLocation.Manual,
                Left = -20000,
                Top = -20000,
                ShowInTaskbar = false,
                ShowActivated = false,
                WindowStyle = WindowStyle.None,
            };
            var reference = new Rectangle { Width = 4, Height = 4, Fill = Brushes.Gray };
            var root = new System.Windows.Controls.StackPanel();
            root.Children.Add(reference);
            root.Children.Add(host);
            win.Content = root;
            win.Show();

            var refPulse = new DoubleAnimation(1.0, 0.55, TimeSpan.FromSeconds(1.1)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever };
            refPulse.CurrentTimeInvalidated += OnRefInvalidated;
            reference.BeginAnimation(UIElement.OpacityProperty, refPulse);

            var pool = new KeyedCardPool();
            int ticks = 0;
            var sw = Stopwatch.StartNew();
            double lastSampleAt = 0;
            long lastSpinnerInv = 0, lastRefInv = 0;
            long cumulativeRetired = 0, lastRetired = 0;
            bool pendingEmptyCheck = false;   // set right when the rail clears; measured at quiet-window end
            bool reportEmptyCheck = false;    // this sample IS that measurement

            void Sample()
            {
                double now = sw.Elapsed.TotalSeconds;
                int expectedSpinners = Items.Count(i => !i.HasProgress);
                double estLiveSpinnerClocks = _refInvalidations == lastRefInv ? -1
                    : Math.Round((double)(_spinnerInvalidations - lastSpinnerInv) / (_refInvalidations - lastRefInv), 2);

                var row = new Dictionary<string, object>
                {
                    ["elapsedSec"] = Math.Round(now, 1),
                    ["ticks"] = ticks,
                    ["itemsOnRail"] = Items.Count,
                    ["expectedSpinners"] = expectedSpinners,
                    ["estLiveSpinnerClocks"] = estLiveSpinnerClocks,
                    ["iconsCreated"] = Interlocked.Read(ref _iconsCreated),
                    ["iconsRetiredInWindow"] = cumulativeRetired - lastRetired,
                    // Only meaningful on the dedicated post-full-clear quiet-window sample (see
                    // _quietUntilTick) — every other row's window mixes pre/post-clear activity,
                    // which a retrospective invalidation-count ratio can't cleanly separate.
                    ["zeroClockOnEmptyRail"] = reportEmptyCheck ? (Items.Count == 0 && estLiveSpinnerClocks <= 0.5) : (object)"n/a",
                };
                Samples.Add(row);
                Console.WriteLine(JsonSerializer.Serialize(row));

                lastSampleAt = now;
                lastSpinnerInv = _spinnerInvalidations;
                lastRefInv = _refInvalidations;
                lastRetired = cumulativeRetired;
                reportEmptyCheck = false;
            }

            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(o.TickMs) };
            timer.Tick += (_, _) =>
            {
                int t = ticks++;
                bool wasNonEmpty = Items.Count > 0;
                Advance(t, o);
                if (wasNonEmpty && Items.Count == 0)
                {
                    // Reset the ratio baseline right now so the eventual quiet-window sample's
                    // window covers only the post-clear silence, not the busy time before it.
                    lastSpinnerInv = _spinnerInvalidations;
                    lastRefInv = _refInvalidations;
                    pendingEmptyCheck = true;
                }
                if (pendingEmptyCheck && t == _quietUntilTick - 1)
                {
                    pendingEmptyCheck = false;
                    reportEmptyCheck = true;
                }

                pool.BeginPass();
                var children = new List<UIElement>();
                foreach (var item in Items)
                {
                    string key = $"rail-{item.Id}";
                    string cacheKey = $"{item.HasProgress}|{item.PercentBucket}";
                    children.Add(pool.Acquire(key, cacheKey,
                        () => item.HasProgress ? BuildPercentIcon(item) : BuildSpinnerIcon(item),
                        out _));
                }
                KeyedCardPool.SyncChildren(host, children);
                pool.EndPass();
                cumulativeRetired += pool.Retired; // Retired resets every pass — accumulate it ourselves

                if (sw.Elapsed.TotalSeconds - lastSampleAt >= o.SampleSeconds || reportEmptyCheck)
                    Sample();

                if (sw.Elapsed.TotalSeconds >= o.Seconds)
                {
                    Sample();
                    timer.Stop();
                    win.Close();
                    app.Shutdown();
                }
            };
            timer.Start();
            app.Run();

            File.WriteAllText(o.Out, JsonSerializer.Serialize(new { samples = Samples }, new JsonSerializerOptions { WriteIndented = true }));

            bool anyBadEmpty = Samples.Any(s => s.TryGetValue("zeroClockOnEmptyRail", out var v) && v is bool b && !b);
            bool spinnerMismatch = Samples.Skip(2).Any(s =>
                (double)s["estLiveSpinnerClocks"] >= 0 &&
                Math.Abs((double)s["estLiveSpinnerClocks"] - (int)s["expectedSpinners"]) > 1.0);

            Console.WriteLine($"[probe] anyBadEmpty={anyBadEmpty} spinnerMismatch={spinnerMismatch}");
            return anyBadEmpty || spinnerMismatch ? 1 : 0;
        }
    }
}

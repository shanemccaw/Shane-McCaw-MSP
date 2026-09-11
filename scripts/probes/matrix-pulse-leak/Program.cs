// Git #3689 — kept diagnostic: measures the Build Matrix drawer's slot-card pulse-animation leak.
//
// Runs as its own process with its own offscreen window. It never launches, attaches to, or drives
// BuildConsole. It drives the REAL desktop/BuildConsole/Controls/KeyedSlotCardHost.cs (linked in the
// csproj) the way BuildQueuePanel.RenderMatrixDrawer does, or ("legacy") an exact replica of the
// pre-#3689 Children.Clear()+rebuild tail, on the same tick schedule and the same card shape
// (a Border whose busy state starts a 1.1s AutoReverse RepeatBehavior.Forever opacity pulse —
// via BeginAnimation for legacy, via KeyedSlotCardHost.BeginOwnedAnimation for fixed).
//
// --mode detach-experiment instead measures, for 400 pulses per phase, which mechanism actually
// stops a clock: BeginAnimation(null), Children.Clear(), a full GC, Controller.Stop(), and the
// shipped KeyedSlotCardHost.Retire().
//
//   dotnet build -c Release
//   bin\Release\net8.0-windows\MatrixPulseLeakProbe.exe --mode legacy|fixed --seconds 300 --tickMs 50 --out results\x.json
//
// The real app ticks every 5000 ms (_localQueuePollTimer), so --tickMs 50 is 100x accelerated.
// Schedule: drawer open except 20 of every 400 ticks; one busy slot swaps to a new build every 100
// ticks; slot 1's pill flips RUNNING <-> NEEDS INPUT every 150 ticks.
//
// Measured per sample (no forced GC unless --forceGc true, so clocks accumulate exactly as they
// would in the app between the runtime's own collections — WPF holds an animation's target weakly,
// so a discarded card's clock keeps ticking until a GC happens to collect that card):
//   clockInvalidationsPerSec — CurrentTimeInvalidated firings/sec across every pulse clock ever
//                              started, i.e. (live animation clocks) x (frame rate). The direct leak signal.
//   aliveDiscardedCards      — cards no longer in the panel that have not been collected yet.
//   gen0/gen1/gen2 GC counts, cpuPercentOneCore, privateMB, managedMB.
// Counted every tick:
//   discardedStillAnimated   — a card removed from the panel with its animation still attached.
//   restartedUnchangedSlots  — an open slot whose content did not change but whose card was replaced
//                              (its pulse restarted). Expected 0 for the fix.
//   busyCardsNotAnimating    — a busy card in the panel with no running pulse. Expected 0.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using BuildConsole.Controls;

namespace MatrixPulseLeakProbe
{
    internal sealed record SlotState(int Slot, bool Busy, int BuildId, string Pill);

    internal sealed class Options
    {
        public string Mode = "fixed";
        public double Seconds = 300;
        public int TickMs = 50;
        public int Slots = 8;
        public int Busy = 8;
        public double SampleSeconds = 15;
        public bool ForceGc;
        public string Out = "result.json";

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (int i = 0; i + 1 < args.Length; i += 2)
            {
                string v = args[i + 1];
                switch (args[i])
                {
                    case "--mode": o.Mode = v; break;
                    case "--seconds": o.Seconds = double.Parse(v); break;
                    case "--tickMs": o.TickMs = int.Parse(v); break;
                    case "--slots": o.Slots = int.Parse(v); break;
                    case "--busy": o.Busy = int.Parse(v); break;
                    case "--sampleSeconds": o.SampleSeconds = double.Parse(v); break;
                    case "--forceGc": o.ForceGc = bool.Parse(v); break;
                    case "--out": o.Out = v; break;
                    default: throw new ArgumentException($"unknown option {args[i]}");
                }
            }
            if (o.Mode != "legacy" && o.Mode != "fixed" && o.Mode != "detach-experiment")
                throw new ArgumentException("--mode must be legacy, fixed or detach-experiment");
            o.Busy = Math.Clamp(o.Busy, 0, o.Slots);
            return o;
        }
    }

    internal static class Program
    {
        private static long _clockInvalidations;
        private static long _lastTickUtc = DateTime.UtcNow.Ticks;
        private static readonly object Gate = new();
        private static readonly List<Dictionary<string, object>> Samples = new();
        private static readonly Dictionary<string, object> Totals = new();
        private static int _written;

        // One always-running reference clock: its invalidations/sec is the frame rate, so
        // pulse invalidations / reference invalidations = number of live pulse clocks.
        private static long _refInvalidations;

        private static void OnClockInvalidated(object? sender, EventArgs e) => _clockInvalidations++;
        private static void OnRefInvalidated(object? sender, EventArgs e) => _refInvalidations++;

        private static DoubleAnimation Pulse(EventHandler counter)
        {
            // Same parameters as BuildQueuePanel.MatrixSlotCard's pulse.
            var pulse = new DoubleAnimation
            {
                From = 1.0,
                To = 0.55,
                Duration = new Duration(TimeSpan.FromSeconds(1.1)),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };
            pulse.CurrentTimeInvalidated += counter;
            return pulse;
        }

        /// <summary>
        /// --mode detach-experiment: answers "what actually stops a pulse clock?" with 400 cards per
        /// phase, a full GC between phases, and GC counts recorded per window so a GC can't be
        /// mistaken for a stop.
        /// </summary>
        private static async void RunDetachExperiment(Panel host, Options o, Application app)
        {
            const int N = 400;
            var result = new Dictionary<string, object>();

            async Task Measure(string label)
            {
                int g0 = GC.CollectionCount(0), g1 = GC.CollectionCount(1), g2 = GC.CollectionCount(2);
                long p0 = _clockInvalidations, r0 = _refInvalidations;
                await Task.Delay(TimeSpan.FromSeconds(3));
                long dp = _clockInvalidations - p0, dr = _refInvalidations - r0;
                double est = dr == 0 ? -1 : Math.Round((double)dp / dr, 1);
                string gc = $"gen0+{GC.CollectionCount(0) - g0} gen1+{GC.CollectionCount(1) - g1} gen2+{GC.CollectionCount(2) - g2}";
                result[label] = new Dictionary<string, object>
                {
                    ["estLiveClocks"] = est,
                    ["pulseInvalidations"] = dp,
                    ["referenceFrames"] = dr,
                    ["gcDuringWindow"] = gc,
                };
                Console.WriteLine($"[detach-experiment] {label,-44} estLiveClocks={est,7}  gc: {gc}");
            }

            void FullGc() { GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect(); }

            Border Card() => new Border { Width = 20, Height = 20, Margin = new Thickness(1), Background = Brushes.SteelBlue };

            await Measure("0 empty panel");

            var cards = new List<Border>();
            for (int i = 0; i < N; i++) { var c = Card(); c.BeginAnimation(UIElement.OpacityProperty, Pulse(OnClockInvalidated)); host.Children.Add(c); cards.Add(c); }
            await Measure("1 attached via BeginAnimation");

            // #3689's first proposed fix: BeginAnimation(null), then drop the card.
            foreach (var c in cards) c.BeginAnimation(UIElement.OpacityProperty, null);
            host.Children.Clear();
            cards.Clear();
            await Measure("2 BeginAnimation(null) + discarded");
            FullGc();

            // What the pre-#3689 code did: Children.Clear() with the pulse still attached.
            for (int i = 0; i < N; i++) { var c = Card(); c.BeginAnimation(UIElement.OpacityProperty, Pulse(OnClockInvalidated)); host.Children.Add(c); }
            await Measure("3a attached again");
            host.Children.Clear();
            await Measure("3b Children.Clear() only (legacy)");
            FullGc();
            await Measure("4 legacy after a full GC");

            // Clocks held strongly, so only the stop mechanism (not a GC) can end the ticking.
            var clocks = new List<AnimationClock>();
            for (int i = 0; i < N; i++)
            {
                var c = Card();
                var clock = Pulse(OnClockInvalidated).CreateClock();
                c.ApplyAnimationClock(UIElement.OpacityProperty, clock);
                host.Children.Add(c);
                clocks.Add(clock);
            }
            await Measure("5a explicit clocks attached (held)");
            foreach (UIElement c in host.Children) c.ApplyAnimationClock(UIElement.OpacityProperty, null);
            host.Children.Clear();
            await Measure("5b detached, clock still referenced");
            foreach (var clock in clocks) clock.Controller!.Stop();
            await Measure("5c then Controller.Stop()");
            clocks.Clear();
            FullGc();

            // The shipped path end to end: BeginOwnedAnimation cards in a KeyedSlotCardHost, then Retire().
            var keyedHost = new KeyedSlotCardHost(host);
            var keys = Enumerable.Range(0, N).Cast<object>().ToArray();
            keyedHost.Reconcile(keys, _ =>
            {
                var c = Card();
                KeyedSlotCardHost.BeginOwnedAnimation(c, UIElement.OpacityProperty, Pulse(OnClockInvalidated));
                return c;
            });
            await Measure("6a KeyedSlotCardHost cards attached");
            keyedHost.Retire();
            await Measure("6b KeyedSlotCardHost.Retire() (fix)");

            File.WriteAllText(o.Out, JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
            app.Shutdown(0);
        }

        private static SlotState StateFor(int slot, int tick, Options o)
        {
            if (slot >= o.Busy) return new SlotState(slot, false, 0, "");
            int rotation = tick / 100;
            int generation = (rotation - slot + o.Busy) / o.Busy; // bumps when rotation ≡ slot (mod busy)
            string pill = slot == 1 && (tick / 150) % 2 == 1 ? "NEEDS INPUT" : "RUNNING";
            return new SlotState(slot, true, slot * 1_000_000 + generation, pill);
        }

        [STAThread]
        private static int Main(string[] args)
        {
            var o = Options.Parse(args);
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(o.Out))!);

            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            var host = new WrapPanel();
            var win = new Window
            {
                Title = "MatrixPulseLeakProbe",
                Width = 1300,
                Height = 200,
                WindowStartupLocation = WindowStartupLocation.Manual,
                Left = -20000,
                Top = -20000,
                ShowInTaskbar = false,
                ShowActivated = false,
                WindowStyle = WindowStyle.None,
            };
            var reference = new System.Windows.Shapes.Rectangle { Width = 4, Height = 4, Fill = Brushes.Gray, HorizontalAlignment = HorizontalAlignment.Left };
            var root = new StackPanel();
            root.Children.Add(reference);
            root.Children.Add(host);
            win.Content = root;
            win.Show();
            reference.BeginAnimation(UIElement.OpacityProperty, Pulse(OnRefInvalidated));

            if (o.Mode == "detach-experiment")
            {
                app.Dispatcher.BeginInvoke(new Action(() => RunDetachExperiment(host, o, app)));
                app.Run();
                return 0;
            }

            var created = new List<WeakReference<Border>>();
            long cardsCreated = 0, discardedStillAnimated = 0, restartedUnchangedSlots = 0, busyCardsNotAnimating = 0;
            int ticks = 0;
            SlotState[]? prevStates = null;
            UIElement[]? prevCards = null;
            var keyed = o.Mode == "fixed" ? new KeyedSlotCardHost(host) : null;

            Border MakeCard(SlotState s)
            {
                var accent = Color.FromRgb(0x89, 0xB4, 0xFA);
                var card = new Border
                {
                    Width = 150,
                    Margin = new Thickness(0, 0, 6, 6),
                    CornerRadius = new CornerRadius(6),
                    Padding = new Thickness(8, 6, 8, 6),
                    Background = new SolidColorBrush(Color.FromArgb(0x1a, accent.R, accent.G, accent.B)),
                    BorderBrush = new SolidColorBrush(Color.FromArgb(0x66, accent.R, accent.G, accent.B)),
                    BorderThickness = new Thickness(1),
                    Opacity = s.Busy ? 1.0 : 0.45,
                    Tag = s
                };
                var stack = new StackPanel();
                stack.Children.Add(new TextBlock { Text = $"SLOT {s.Slot + 1}", FontSize = 9, FontWeight = FontWeights.Bold });
                if (s.Busy)
                {
                    stack.Children.Add(new TextBlock { Text = s.Pill, FontSize = 9.5, FontWeight = FontWeights.Bold });
                    stack.Children.Add(new TextBlock { Text = $"#{s.BuildId} probe build", FontSize = 10.5, TextTrimming = TextTrimming.CharacterEllipsis });
                    stack.Children.Add(new TextBlock { Text = "probe-set · claude-opus-5 · high", FontSize = 9, TextTrimming = TextTrimming.CharacterEllipsis });

                    // legacy: BeginAnimation, as the pre-#3689 MatrixSlotCard did.
                    // fixed: BeginOwnedAnimation, as MatrixSlotCard does now.
                    if (keyed == null) card.BeginAnimation(UIElement.OpacityProperty, Pulse(OnClockInvalidated));
                    else KeyedSlotCardHost.BeginOwnedAnimation(card, UIElement.OpacityProperty, Pulse(OnClockInvalidated));
                }
                else
                {
                    stack.Children.Add(new TextBlock { Text = "Idle", FontSize = 10.5 });
                }
                card.Child = stack;
                cardsCreated++;
                created.Add(new WeakReference<Border>(card));
                return card;
            }

            var sw = Stopwatch.StartNew();
            double lastSampleAt = 0;
            TimeSpan lastCpu = Process.GetCurrentProcess().TotalProcessorTime;
            long lastInvalidations = 0, lastRefInvalidations = 0;
            int lastSampleTicks = 0;

            void Sample()
            {
                if (o.ForceGc)
                {
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                    GC.Collect();
                }
                double now = sw.Elapsed.TotalSeconds;
                double span = Math.Max(0.001, now - lastSampleAt);
                var inHost = new HashSet<UIElement>(host.Children.Cast<UIElement>());
                int alive = 0, aliveDiscarded = 0;
                created.RemoveAll(w => !w.TryGetTarget(out _));
                foreach (var w in created)
                {
                    if (!w.TryGetTarget(out var c)) continue;
                    alive++;
                    if (!inHost.Contains(c)) aliveDiscarded++;
                }
                var p = Process.GetCurrentProcess();
                var cpu = p.TotalProcessorTime;
                var row = new Dictionary<string, object>
                {
                    ["elapsedSec"] = Math.Round(now, 1),
                    ["ticks"] = ticks,
                    ["ticksPerSecInWindow"] = Math.Round((ticks - lastSampleTicks) / span, 2),
                    ["equivalentAppMinutes"] = Math.Round(ticks * 5.0 / 60.0, 1),
                    ["cardsCreated"] = cardsCreated,
                    ["cardsInPanel"] = inHost.Count,
                    ["aliveCards"] = alive,
                    ["aliveDiscardedCards"] = aliveDiscarded,
                    ["clockInvalidationsPerSec"] = Math.Round((_clockInvalidations - lastInvalidations) / span, 1),
                    ["renderFps"] = Math.Round((_refInvalidations - lastRefInvalidations) / span, 1),
                    ["estLiveClocks"] = _refInvalidations == lastRefInvalidations ? -1
                        : Math.Round((double)(_clockInvalidations - lastInvalidations) / (_refInvalidations - lastRefInvalidations), 1),
                    ["cpuPercentOneCore"] = Math.Round((cpu - lastCpu).TotalSeconds / span * 100.0, 1),
                    ["privateMB"] = Math.Round(p.PrivateMemorySize64 / 1048576.0, 1),
                    ["managedMB"] = Math.Round(GC.GetTotalMemory(false) / 1048576.0, 1),
                    ["gcGen0"] = GC.CollectionCount(0),
                    ["gcGen1"] = GC.CollectionCount(1),
                    ["gcGen2"] = GC.CollectionCount(2),
                    ["discardedStillAnimated"] = discardedStillAnimated,
                    ["restartedUnchangedSlots"] = restartedUnchangedSlots,
                    ["busyCardsNotAnimating"] = busyCardsNotAnimating,
                };
                lock (Gate) Samples.Add(row);
                Console.WriteLine($"[{o.Mode}] " + JsonSerializer.Serialize(row));
                lastSampleTicks = ticks;
                // Windows start after this sample's own GC + bookkeeping, so the next CPU figure
                // measures only tick work, not the measurement.
                lastSampleAt = sw.Elapsed.TotalSeconds;
                lastCpu = Process.GetCurrentProcess().TotalProcessorTime;
                lastInvalidations = _clockInvalidations;
                lastRefInvalidations = _refInvalidations;
            }

            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(o.TickMs) };
            timer.Tick += (_, _) =>
            {
                int t = ticks++;
                Interlocked.Exchange(ref _lastTickUtc, DateTime.UtcNow.Ticks);
                bool open = t % 400 < 380;
                var states = Enumerable.Range(0, o.Slots).Select(s => StateFor(s, t, o)).ToArray();
                var before = host.Children.Cast<UIElement>().ToList();

                if (keyed == null)
                {
                    // Exact replica of the pre-#3689 RenderMatrixDrawer tail.
                    if (open)
                    {
                        host.Children.Clear();
                        for (int s = 0; s < o.Slots; s++) host.Children.Add(MakeCard(states[s]));
                    }
                }
                else
                {
                    // Same calls BuildQueuePanel.RenderMatrixDrawer now makes.
                    if (!open) keyed.Retire();
                    else keyed.Reconcile(states, s => MakeCard(states[s]));
                }

                var after = host.Children.Cast<UIElement>().ToList();
                var afterSet = new HashSet<UIElement>(after);
                foreach (var gone in before)
                    if (!afterSet.Contains(gone) && gone.HasAnimatedProperties) discardedStillAnimated++;
                foreach (var c in after.OfType<Border>())
                    if (((SlotState)c.Tag).Busy && !c.HasAnimatedProperties) busyCardsNotAnimating++;
                if (open && prevStates != null && prevCards != null && prevCards.Length == after.Count)
                {
                    for (int s = 0; s < o.Slots; s++)
                        if (Equals(prevStates[s], states[s]) && !ReferenceEquals(prevCards[s], after[s])) restartedUnchangedSlots++;
                }
                prevStates = open ? states : null;
                prevCards = open ? after.ToArray() : null;

                if (sw.Elapsed.TotalSeconds - lastSampleAt >= o.SampleSeconds) Sample();
                if (sw.Elapsed.TotalSeconds >= o.Seconds)
                {
                    timer.Stop();
                    Sample();
                    lock (Gate)
                    {
                        Totals["uiThreadStalled"] = false;
                        Totals["ticks"] = ticks;
                    }
                    Write(o);
                    app.Shutdown(0);
                }
            };

            // Watchdog: if the UI thread stops servicing ticks, record that (it IS the hang the
            // issue describes) instead of waiting forever.
            var watchdog = new Thread(() =>
            {
                while (true)
                {
                    Thread.Sleep(1000);
                    var sinceTick = TimeSpan.FromTicks(DateTime.UtcNow.Ticks - Interlocked.Read(ref _lastTickUtc));
                    if (sinceTick.TotalSeconds > 30 || sw.Elapsed.TotalSeconds > o.Seconds + 120)
                    {
                        lock (Gate)
                        {
                            Totals["uiThreadStalled"] = true;
                            Totals["secondsSinceLastTick"] = Math.Round(sinceTick.TotalSeconds, 1);
                        }
                        Write(o);
                        Environment.Exit(2);
                    }
                }
            }) { IsBackground = true };
            watchdog.Start();

            timer.Start();
            app.Run();
            return 0;
        }

        private static void Write(Options o)
        {
            if (Interlocked.Exchange(ref _written, 1) == 1) return;
            lock (Gate)
            {
                var doc = new Dictionary<string, object>
                {
                    ["mode"] = o.Mode,
                    ["tickMs"] = o.TickMs,
                    ["seconds"] = o.Seconds,
                    ["slots"] = o.Slots,
                    ["busy"] = o.Busy,
                    ["forceGc"] = o.ForceGc,
                    ["totals"] = Totals,
                    ["samples"] = Samples,
                };
                File.WriteAllText(o.Out, JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true }));
            }
        }
    }
}

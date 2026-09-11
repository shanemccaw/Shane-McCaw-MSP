// Git #3698 — kept diagnostic: measures BuildQueuePanel.RenderQueue's queue-card mascot animation leak.
//
// Runs as its own process with its own offscreen window. It never launches, attaches to, or drives
// BuildConsole — and doesn't host a real BuildQueuePanel either, because constructing one reaches the
// live app's %AppData%\BuildConsole (ActivityLog's watchdog alone writes heartbeat lines into the live
// log). It compiles the REAL desktop/BuildConsole/Controls/KeyedCardPool.cs and KeyedSlotCardHost.cs
// and renders a synthetic queue in RenderQueue's shape: an optional offline banner, restart
// pseudo-cards and ungrouped cards at the top level, then one container per build set holding a
// header and that set's cards. Every card carries a replica of CreateQueueCardMascot: a Canvas whose
// TranslateTransform floats (AutoReverse, RepeatBehavior.Forever, SineEase, 2.8 s, 3.2 s when blocked)
// and whose critter's DropShadowEffect shimmers (Forever, 2.2 s, 2.8 s when blocked) when the item is
// running or blocked — the same parameters as the real mascot.
//
//   --mode legacy   exact replica of the pre-#3698 tail: QueueCardsHost.Children.Clear(), then rebuild
//                   every container and card, float/shimmer started with BeginAnimation.
//   --mode interim  the issue's fallback: stop every existing card's owned clocks, then Clear() + rebuild.
//   --mode fixed    the shipped path: KeyedCardPool BeginPass / Acquire / SyncChildren / EndPass — the same
//                   calls RenderQueue now makes — with mascots started via KeyedSlotCardHost.BeginOwnedAnimation.
//
//   dotnet build -c Release
//   bin\Release\net8.0-windows\QueueCardLeakProbe.exe --mode legacy|interim|fixed --seconds 300 --tickMs 50 --out results\x.json
//
// One tick = one RenderQueue call. The real app calls it on every 5 s local poll whose queue signature
// changed, on every Git Board refresh (ApplyOpenIssueSet, unconditionally) and on every blocker-title
// fetch, so --tickMs 50 is a 100x-accelerated worst case of one render per poll.
// Schedule (ticks): one real status transition every 40, a new item every 120 (oldest done item drops
// out), the selection moves every 200, build set "bravo" toggles priority every 330 (its container is
// rebuilt and its cards move into the new one), the offline banner toggles every 450, and every 700 the
// view spends 10 ticks on "All" (RenderQueue's broad-view early return: pool RetireAll + Clear).
//
// Measured per sample (no forced GC unless --forceGc true, so discarded clocks accumulate exactly as
// they would in the app between the runtime's own collections):
//   estLiveClocks            (float + shimmer invalidations) / (reference clock invalidations): live mascot clocks.
//   expectedClocks           one float per card on screen + one shimmer per running/blocked card on screen.
//   aliveDiscardedCards, cpuPercentOneCore, privateMB, managedMB, allocatedMBPerSec, gen0/1/2 counts.
// Counted every tick:
//   discardedStillAnimated   a card that left the tree with its float still attached. Expected 0 (interim, fixed).
//   rebuiltUnchangedCards    a card whose model didn't change but whose element was replaced. Expected 0 (fixed).
//   cardsMissingFloat        a card on screen with no float running. Expected 0.
//   layoutMismatchTicks      the tree didn't match the intended render (order, nesting, header, stale card). Expected 0.
//   keptCardUnloads          Unloaded raised on a card still in the tree. MEASURED NON-ZERO in fixed mode
//                            (148 over 300 s): re-parenting a reused card — moving it between build-set
//                            containers — does raise Unloaded, and Loaded again after it. So this is not 0;
//                            the two counters below are what actually matter about it.
//   cardsInTreeNotLoaded     (per sample) a card on screen for 3+ ticks that isn't Loaded. Expected 0.
//   subscriptionLostCards    (per sample) a card on screen for 3+ ticks whose Loaded/Unloaded-managed
//                            subscription is detached — the real hazard of the above for #2692's
//                            progress-bubble row on a reused card. Expected 0.
//   progressFiringsPerInvoke handler calls from one ProgressChanged invoke: equals the number of cards
//                            still subscribed, so a double-subscribe shows up here too.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Threading;
using BuildConsole.Controls;
using Ellipse = System.Windows.Shapes.Ellipse;
using Polygon = System.Windows.Shapes.Polygon;
using Rectangle = System.Windows.Shapes.Rectangle;
using Shape = System.Windows.Shapes.Shape;

namespace QueueCardLeakProbe
{
    /// <summary>Everything a replica card draws — the probe's QueueCardKey.</summary>
    internal sealed record CardModel(bool IsRestart, int Id, int Number, string Status, string? BuildSet, string Title, bool Selected);

    internal sealed record SetKey(string Name, bool Priority);

    internal sealed record SetParts(string Name, bool Priority, StackPanel Panel, UIElement Header);

    internal sealed class MascotParts
    {
        public MascotParts(TranslateTransform floatTransform) => Float = floatTransform;
        public readonly TranslateTransform Float;
        public int FirstSeenTick = -1;
        /// <summary>Replica of #2692's progress-bubble row subscription state: true while this card's
        /// handler is attached to the ProgressChanged stand-in.</summary>
        public bool Subscribed;
    }

    internal sealed class Item
    {
        public int Id;
        public int Number;
        public string Status = "queued";
        public string? BuildSet;
    }

    internal sealed class Options
    {
        public string Mode = "fixed";
        public double Seconds = 300;
        public int TickMs = 50;
        public int Items = 40;
        public int Restart = 2;
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
                    case "--items": o.Items = int.Parse(v); break;
                    case "--restart": o.Restart = int.Parse(v); break;
                    case "--sampleSeconds": o.SampleSeconds = double.Parse(v); break;
                    case "--forceGc": o.ForceGc = bool.Parse(v); break;
                    case "--out": o.Out = v; break;
                    default: throw new ArgumentException($"unknown option {args[i]}");
                }
            }
            if (o.Mode != "legacy" && o.Mode != "interim" && o.Mode != "fixed")
                throw new ArgumentException("--mode must be legacy, interim or fixed");
            return o;
        }
    }

    internal static class Program
    {
        private const string BannerText = "Offline — showing cached queue";
        private static readonly string[] SetNames = { "alpha", "bravo", "charlie" };

        private static long _clockInvalidations;
        private static long _refInvalidations;
        private static long _keptCardUnloads;
        /// <summary>Stand-in for BuildProgressTracker.ProgressChanged: the real card's progress-bubble
        /// row (#2692) subscribes to it on Loaded and unsubscribes on Unloaded, so a reused card that
        /// gets re-parented could lose its subscription. subscriptionLostCards measures exactly that.</summary>
        private static event Action? ProgressChanged;
        private static long _progressFirings;
        private static long _cardsCreated;
        private static long _lastTickUtc = DateTime.UtcNow.Ticks;
        private static int _written;
        private static readonly object Gate = new();
        private static readonly List<Dictionary<string, object>> Samples = new();
        private static readonly Dictionary<string, object> Totals = new();

        private static readonly ConditionalWeakTable<Border, MascotParts> Mascots = new();
        private static readonly List<WeakReference<Border>> Created = new();
        private static StackPanel _host = null!;

        private static readonly List<Item> Queue = new();
        private static readonly Dictionary<string, bool> Priority = SetNames.ToDictionary(n => n, _ => false);
        private static int _nextId = 1;
        private static int _nextNumber = 5000;
        private static int _selectedId;

        private static void OnClockInvalidated(object? sender, EventArgs e) => _clockInvalidations++;
        private static void OnRefInvalidated(object? sender, EventArgs e) => _refInvalidations++;

        private static SolidColorBrush Solid(byte r, byte g, byte b, byte a = 0xFF) => new(Color.FromArgb(a, r, g, b));

        // ── the synthetic queue ─────────────────────────────────────────────────────────────

        private static void Seed(Options o)
        {
            for (int i = 0; i < o.Items; i++)
            {
                string status = (i % 20) switch { < 4 => "running", < 9 => "blocked", < 15 => "queued", _ => "done" };
                Queue.Add(new Item { Id = _nextId++, Number = _nextNumber++, Status = status, BuildSet = i % 4 == 0 ? null : SetNames[i % 3] });
            }
            _selectedId = Queue[0].Id;
        }

        private static void Advance(int t, Options o)
        {
            if (t == 0) return;
            if (t % 40 == 0)
            {
                var candidates = Queue.Where(i => i.Status != "done").ToList();
                if (candidates.Count > 0)
                {
                    var it = candidates[(t / 40) % candidates.Count];
                    it.Status = it.Status switch { "queued" => "running", "running" => "done", "blocked" => "queued", _ => it.Status };
                }
            }
            if (t % 120 == 0)
            {
                int n = t / 120;
                Queue.Add(new Item { Id = _nextId++, Number = _nextNumber++, Status = n % 3 == 0 ? "blocked" : "queued", BuildSet = n % 4 == 0 ? null : SetNames[n % 3] });
                var oldestDone = Queue.FirstOrDefault(i => i.Status == "done");
                if (Queue.Count > o.Items && oldestDone != null) Queue.Remove(oldestDone);
            }
            if (t % 200 == 0 && Queue.Count > 0) _selectedId = Queue[(t / 200) % Queue.Count].Id;
            if (t % 330 == 0) Priority["bravo"] = !Priority["bravo"];
        }

        /// <summary>RenderQueue's order: restart pseudo-nodes, ungrouped items, then each build set's
        /// items together, a set whose every item is blocked last (#1825).</summary>
        private static List<CardModel> Ordered(Options o)
        {
            var list = new List<CardModel>();
            for (int r = 0; r < o.Restart; r++)
                list.Add(new CardModel(true, -(r + 1), 4000 + r, "restart", null, $"Queued for restart {r + 1}", false));
            CardModel Model(Item i) => new(false, i.Id, i.Number, i.Status, i.BuildSet, $"#{i.Number} synthetic queue item {i.Id}", i.Id == _selectedId);
            list.AddRange(Queue.Where(i => i.BuildSet == null).OrderByDescending(i => i.Number).Select(Model));
            foreach (var set in SetNames.OrderBy(s => Queue.Where(i => i.BuildSet == s).All(i => i.Status == "blocked") ? 1 : 0))
                list.AddRange(Queue.Where(i => i.BuildSet == set).OrderByDescending(i => i.Number).Select(Model));
            return list;
        }

        // ── replica elements ────────────────────────────────────────────────────────────────

        /// <summary>Static vector art in the shape of BuildQueuePanel's CreateCute*Vector critters: a
        /// small canvas of shapes with no animation of its own.</summary>
        private static Canvas CritterArt(int variant)
        {
            var c = new Canvas { Width = 30, Height = 30 };
            void Add(Shape s, double x, double y) { Canvas.SetLeft(s, x); Canvas.SetTop(s, y); c.Children.Add(s); }
            var fur = Solid(0xF9, 0x73, 0x16);
            Add(new Ellipse { Width = 22, Height = 20, Fill = fur }, 4, 8);
            Add(new Ellipse { Width = 6, Height = 7, Fill = Solid(0x1E, 0x1E, 0x2E) }, 9, 13);
            Add(new Ellipse { Width = 6, Height = 7, Fill = Solid(0x1E, 0x1E, 0x2E) }, 17, 13);
            Add(new Ellipse { Width = 2, Height = 2, Fill = Brushes.White }, 11, 14);
            Add(new Ellipse { Width = 2, Height = 2, Fill = Brushes.White }, 19, 14);
            Add(new Polygon { Points = new PointCollection { new(4, 10), new(8, 2), new(12, 9) }, Fill = fur }, 0, 0);
            Add(new Polygon { Points = new PointCollection { new(18, 9), new(22, 2), new(26, 10) }, Fill = fur }, 0, 0);
            Add(new Ellipse { Width = 5, Height = 3, Fill = Solid(0xF4, 0x72, 0xB6) }, 6 + variant % 3, 21);
            Add(new Ellipse { Width = 5, Height = 3, Fill = Solid(0xF4, 0x72, 0xB6) }, 19, 21);
            Add(new Ellipse { Width = 4, Height = 3, Fill = Solid(0x1E, 0x1E, 0x2E) }, 13, 19);
            return c;
        }

        /// <summary>Replica of CreateQueueCardMascot / CreateGenericCardMascot's animation shape.</summary>
        private static Canvas BuildMascot(CardModel m, bool owned, out MascotParts parts)
        {
            bool isBlocked = m.Status == "blocked";
            bool isRunning = m.Status == "running";
            var container = new Canvas
            {
                Width = 42,
                Height = 36,
                Margin = new Thickness(4, 0, 2, 0),
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Right,
                ClipToBounds = false
            };
            var floatTrans = new TranslateTransform();
            container.RenderTransform = floatTrans;
            var floatAnim = new DoubleAnimation(0, isBlocked ? -0.8 : -1.2, TimeSpan.FromSeconds(isBlocked ? 3.2 : 2.8))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            floatAnim.CurrentTimeInvalidated += OnClockInvalidated;
            if (owned) KeyedSlotCardHost.BeginOwnedAnimation(container, floatTrans, TranslateTransform.YProperty, floatAnim);
            else floatTrans.BeginAnimation(TranslateTransform.YProperty, floatAnim);

            var critter = new Viewbox { Width = 37, Height = 32, Child = CritterArt(m.Number), Stretch = Stretch.Uniform };
            Canvas.SetLeft(critter, 3);
            Canvas.SetTop(critter, 3);
            container.Children.Add(critter);

            var glow = new DropShadowEffect
            {
                Color = isBlocked ? Color.FromRgb(0xF3, 0x8B, 0xA8) : isRunning ? Color.FromRgb(0x89, 0xB4, 0xFA) : Color.FromRgb(0xCB, 0xA6, 0xF7),
                BlurRadius = isRunning ? 10 : (isBlocked ? 7 : 6),
                ShadowDepth = 0,
                Opacity = isRunning ? 0.65 : 0.38
            };
            critter.Effect = glow;
            if (isRunning || isBlocked)
            {
                var shimmer = new DoubleAnimation(0.30, isBlocked ? 0.65 : 0.85, TimeSpan.FromSeconds(isBlocked ? 2.8 : 2.2))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                };
                shimmer.CurrentTimeInvalidated += OnClockInvalidated;
                if (owned) KeyedSlotCardHost.BeginOwnedAnimation(container, glow, DropShadowEffect.OpacityProperty, shimmer);
                else glow.BeginAnimation(DropShadowEffect.OpacityProperty, shimmer);
            }
            if (isBlocked)
            {
                var lockBadge = new Border
                {
                    Background = Solid(0xF3, 0x8B, 0xA8),
                    CornerRadius = new CornerRadius(5),
                    Padding = new Thickness(3, 1, 3, 1),
                    Effect = new DropShadowEffect { Color = Color.FromRgb(0xF3, 0x8B, 0xA8), BlurRadius = 4, ShadowDepth = 0 },
                    Child = new TextBlock { Text = "L", FontSize = 9 }
                };
                Canvas.SetLeft(lockBadge, 22);
                Canvas.SetTop(lockBadge, -3);
                container.Children.Add(lockBadge);
            }
            parts = new MascotParts(floatTrans);
            return container;
        }

        private static Border Pill(string text, Color color) => new()
        {
            Background = new SolidColorBrush(Color.FromArgb(0x33, color.R, color.G, color.B)),
            BorderBrush = new SolidColorBrush(color),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(6, 1.5, 6, 1.5),
            Margin = new Thickness(0, 0, 6, 0),
            Child = new TextBlock { Text = text, FontSize = 9.5, FontWeight = FontWeights.Bold, Foreground = new SolidColorBrush(color) }
        };

        /// <summary>Replica of BuildQueueCard's structure: pills row, title, a ghost blocker card when
        /// blocked, and the mascot in a right-hand grid column.</summary>
        private static Border BuildCard(CardModel m, bool owned)
        {
            var (accent, pill) = m.Status switch
            {
                "running" => (Color.FromRgb(0x89, 0xB4, 0xFA), "RUNNING"),
                "blocked" => (Color.FromRgb(0xF3, 0x8B, 0xA8), "BLOCKED"),
                "done" => (Color.FromRgb(0xA6, 0xE3, 0xA1), "DONE"),
                "restart" => (Color.FromRgb(0xCB, 0xA6, 0xF7), "RESTART"),
                _ => (Color.FromRgb(0x6C, 0x70, 0x86), "UP NEXT"),
            };
            var card = new Border
            {
                Background = Solid(0x18, 0x18, 0x25),
                BorderBrush = m.Selected ? Solid(0x89, 0xB4, 0xFA) : new SolidColorBrush(Color.FromArgb(0x80, accent.R, accent.G, accent.B)),
                BorderThickness = new Thickness(m.Selected ? 1.8 : 1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(8, 6, 8, 6),
                Margin = new Thickness(0, 2, 0, 3),
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Tag = m
            };
            var main = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            var top = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 3) };
            top.Children.Add(Pill(pill, accent));
            top.Children.Add(Pill($"#{m.Number}", Color.FromRgb(0xFA, 0xB3, 0x87)));
            top.Children.Add(Pill("Opus - High", Color.FromRgb(0xBA, 0xB4, 0xCD)));
            main.Children.Add(top);
            main.Children.Add(new TextBlock { Text = m.Title, FontSize = 11.5, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(1, 2, 1, 0) });
            if (m.Status == "blocked")
            {
                main.Children.Add(new Border
                {
                    Background = Solid(0x1A, 0x14, 0x18),
                    BorderBrush = new SolidColorBrush(Color.FromArgb(0x80, 0xF3, 0x8B, 0xA8)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(5),
                    Padding = new Thickness(6, 3, 6, 3),
                    Margin = new Thickness(1, 3, 0, 0),
                    Opacity = 0.68,
                    Child = new TextBlock { Text = $"OPEN #{m.Number - 1} blocker title", FontSize = 9.5 }
                });
            }
            var grid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(main, 0);
            grid.Children.Add(main);
            var mascot = BuildMascot(m, owned, out var parts);
            Grid.SetColumn(mascot, 1);
            grid.Children.Add(mascot);
            card.Child = grid;

            Mascots.Add(card, parts);
            // Same shape as BuildProgressBubbleRow: subscribe on Loaded, unsubscribe on Unloaded.
            void OnProgressChanged() => Interlocked.Increment(ref _progressFirings);
            card.Loaded += (_, _) => { ProgressChanged += OnProgressChanged; parts.Subscribed = true; };
            card.Unloaded += (_, _) =>
            {
                ProgressChanged -= OnProgressChanged;
                parts.Subscribed = false;
                if (UnderHost(card)) Interlocked.Increment(ref _keptCardUnloads);
            };
            _cardsCreated++;
            Created.Add(new WeakReference<Border>(card));
            return card;
        }

        private static Border BuildSetContainer(string name, bool priority)
        {
            var container = new Border
            {
                BorderBrush = priority ? Solid(0xFA, 0xB3, 0x87) : Solid(0xCB, 0xA6, 0xF7),
                BorderThickness = new Thickness(priority ? 2.5 : 1),
                CornerRadius = new CornerRadius(6),
                Background = new SolidColorBrush(Color.FromArgb(0x0A, 0xCB, 0xA6, 0xF7)),
                Margin = new Thickness(0, 8, 0, 8),
                Padding = new Thickness(8, 6, 8, 6),
                HorizontalAlignment = HorizontalAlignment.Stretch
            };
            var panel = new StackPanel();
            container.Child = panel;
            var header = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(2, 2, 2, 6) };
            header.Children.Add(new TextBlock { Text = "SET ", FontSize = 11 });
            header.Children.Add(new TextBlock { Text = name.ToUpperInvariant(), FontSize = 11, FontWeight = FontWeights.Bold });
            if (priority) header.Children.Add(new TextBlock { Text = " PRIORITY", FontSize = 11 });
            panel.Children.Add(header);
            container.Tag = new SetParts(name, priority, panel, header);
            return container;
        }

        private static Border BuildBanner(string text) => new()
        {
            Background = Solid(0xFA, 0xB3, 0x87, 0x33),
            BorderBrush = Solid(0xFA, 0xB3, 0x87),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8, 4, 8, 4),
            Margin = new Thickness(0, 0, 0, 6),
            Tag = "banner",
            Child = new TextBlock { Text = text, FontSize = 10.5, TextWrapping = TextWrapping.Wrap }
        };

        // ── the three render paths ──────────────────────────────────────────────────────────

        private static void RenderRebuildAll(List<CardModel> models, bool banner, bool interim)
        {
            if (interim)
                foreach (UIElement child in _host.Children) KeyedSlotCardHost.StopOwnedAnimations(child);
            _host.Children.Clear();
            if (banner) _host.Children.Add(BuildBanner(BannerText));
            string? lastSet = null;
            Panel? setPanel = null;
            foreach (var m in models)
            {
                if (m.BuildSet != lastSet)
                {
                    if (m.BuildSet != null)
                    {
                        var container = BuildSetContainer(m.BuildSet, Priority[m.BuildSet]);
                        _host.Children.Add(container);
                        setPanel = ((SetParts)container.Tag).Panel;
                    }
                    else setPanel = null;
                    lastSet = m.BuildSet;
                }
                var card = BuildCard(m, owned: interim);
                if (setPanel != null)
                {
                    card.Margin = new Thickness(0, 2, 0, 2);
                    setPanel.Children.Add(card);
                }
                else _host.Children.Add(card);
            }
        }

        /// <summary>The same KeyedCardPool calls, in the same order, BuildQueuePanel.RenderQueue makes.</summary>
        private static void RenderPooled(KeyedCardPool pool, List<CardModel> models, bool banner)
        {
            pool.BeginPass();
            var hostChildren = new List<UIElement>();
            if (banner) hostChildren.Add(pool.Acquire("offline-banner", BannerText, () => BuildBanner(BannerText), out _));
            string? lastSet = null;
            List<UIElement>? setChildren = null;
            var setPanels = new List<(Panel Panel, List<UIElement> Children)>();
            foreach (var m in models)
            {
                if (m.BuildSet != lastSet)
                {
                    if (m.BuildSet != null)
                    {
                        string name = m.BuildSet;
                        bool priority = Priority[name];
                        var container = pool.Acquire(("set", name), new SetKey(name, priority), () => BuildSetContainer(name, priority), out _);
                        var parts = (SetParts)container.Tag;
                        hostChildren.Add(container);
                        setChildren = new List<UIElement> { parts.Header };
                        setPanels.Add((parts.Panel, setChildren));
                    }
                    else setChildren = null;
                    lastSet = m.BuildSet;
                }
                var model = m;
                var card = pool.Acquire(m.IsRestart ? ("restart", m.Id) : ("item", m.Id), m, () => BuildCard(model, owned: true), out _);
                if (setChildren != null)
                {
                    card.Margin = new Thickness(0, 2, 0, 2);
                    setChildren.Add(card);
                }
                else hostChildren.Add(card);
            }
            KeyedCardPool.SyncChildren(_host, hostChildren);
            foreach (var (panel, children) in setPanels) KeyedCardPool.SyncChildren(panel, children);
            pool.EndPass();
        }

        private static void RenderAllView(KeyedCardPool? pool, string mode)
        {
            if (mode == "fixed") pool!.RetireAll();
            else if (mode == "interim")
                foreach (UIElement child in _host.Children) KeyedSlotCardHost.StopOwnedAnimations(child);
            _host.Children.Clear();
        }

        // ── measurement helpers ─────────────────────────────────────────────────────────────

        private static bool UnderHost(DependencyObject d)
        {
            for (DependencyObject? p = d; p != null; p = LogicalTreeHelper.GetParent(p))
                if (ReferenceEquals(p, _host)) return true;
            return false;
        }

        private static IEnumerable<Border> CardsInTree()
        {
            foreach (UIElement child in _host.Children)
            {
                if (child is Border { Tag: CardModel }) yield return (Border)child;
                else if (child is Border { Tag: SetParts sp })
                    foreach (UIElement inner in sp.Panel.Children)
                        if (inner is Border { Tag: CardModel } card) yield return card;
            }
        }

        private static string Token(CardModel m) => $"card:{m.Id}:{m.Status}:{m.Selected}:{m.BuildSet}";

        private static bool LayoutMatches(List<CardModel> models, bool banner)
        {
            var expected = new List<string>();
            if (banner) expected.Add("banner");
            string? lastSet = null;
            foreach (var m in models)
            {
                if (m.BuildSet != lastSet)
                {
                    if (lastSet != null) expected.Add("]");
                    if (m.BuildSet != null) expected.Add($"set:{m.BuildSet}:{Priority[m.BuildSet]}[");
                    lastSet = m.BuildSet;
                }
                expected.Add(Token(m));
            }
            if (lastSet != null) expected.Add("]");

            var actual = new List<string>();
            foreach (UIElement child in _host.Children)
            {
                if (child is Border { Tag: "banner" }) actual.Add("banner");
                else if (child is Border { Tag: CardModel cm }) actual.Add(Token(cm));
                else if (child is Border { Tag: SetParts sp })
                {
                    actual.Add($"set:{sp.Name}:{sp.Priority}[");
                    if (sp.Panel.Children.Count == 0 || !ReferenceEquals(sp.Panel.Children[0], sp.Header)) actual.Add("missing-header");
                    for (int i = 1; i < sp.Panel.Children.Count; i++)
                        actual.Add(sp.Panel.Children[i] is Border { Tag: CardModel c2 } ? Token(c2) : "?");
                    actual.Add("]");
                }
                else actual.Add("?");
            }
            return expected.SequenceEqual(actual);
        }

        [STAThread]
        private static int Main(string[] args)
        {
            var o = Options.Parse(args);
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(o.Out))!);
            Seed(o);

            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            _host = new StackPanel();
            var win = new Window
            {
                Title = "QueueCardLeakProbe",
                Width = 520,
                Height = 900,
                WindowStartupLocation = WindowStartupLocation.Manual,
                Left = -20000,
                Top = -20000,
                ShowInTaskbar = false,
                ShowActivated = false,
                WindowStyle = WindowStyle.None,
            };
            var reference = new Rectangle { Width = 4, Height = 4, Fill = Brushes.Gray, HorizontalAlignment = HorizontalAlignment.Left };
            var root = new StackPanel();
            root.Children.Add(reference);
            root.Children.Add(_host);
            win.Content = root;
            win.Show();
            // One always-running reference clock: its invalidations/sec is the frame rate, so mascot
            // invalidations / reference invalidations = number of live mascot clocks.
            var refPulse = new DoubleAnimation(1.0, 0.55, TimeSpan.FromSeconds(1.1)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever };
            refPulse.CurrentTimeInvalidated += OnRefInvalidated;
            reference.BeginAnimation(UIElement.OpacityProperty, refPulse);

            var pool = o.Mode == "fixed" ? new KeyedCardPool() : null;
            long discardedStillAnimated = 0, rebuiltUnchangedCards = 0, cardsMissingFloat = 0, layoutMismatchTicks = 0;
            long poolBuilt = 0, poolReused = 0, poolRetired = 0;
            int ticks = 0;
            Dictionary<int, Border>? prevCardById = null;

            var sw = Stopwatch.StartNew();
            double lastSampleAt = 0;
            TimeSpan lastCpu = Process.GetCurrentProcess().TotalProcessorTime;
            long lastInvalidations = 0, lastRefInvalidations = 0, lastAllocated = GC.GetTotalAllocatedBytes(false);
            long lastPoolBuilt = 0, lastPoolReused = 0, lastPoolRetired = 0;
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
                var inTree = CardsInTree().ToList();
                var inTreeSet = new HashSet<Border>(inTree);
                int alive = 0, aliveDiscarded = 0;
                Created.RemoveAll(w => !w.TryGetTarget(out _));
                foreach (var w in Created)
                {
                    if (!w.TryGetTarget(out var c)) continue;
                    alive++;
                    if (!inTreeSet.Contains(c)) aliveDiscarded++;
                }
                int expectedClocks = inTree.Sum(c => ((CardModel)c.Tag).Status is "running" or "blocked" ? 2 : 1);
                int notLoaded = inTree.Count(c => Mascots.TryGetValue(c, out var mp) && mp.FirstSeenTick >= 0 && ticks - mp.FirstSeenTick >= 3 && !c.IsLoaded);
                int subscriptionLost = inTree.Count(c => Mascots.TryGetValue(c, out var mp) && mp.FirstSeenTick >= 0 && ticks - mp.FirstSeenTick >= 3 && !mp.Subscribed);
                Interlocked.Exchange(ref _progressFirings, 0);
                ProgressChanged?.Invoke();
                long allocated = GC.GetTotalAllocatedBytes(false);
                var p = Process.GetCurrentProcess();
                var cpu = p.TotalProcessorTime;
                var row = new Dictionary<string, object>
                {
                    ["elapsedSec"] = Math.Round(now, 1),
                    ["ticks"] = ticks,
                    ["ticksPerSecInWindow"] = Math.Round((ticks - lastSampleTicks) / span, 2),
                    ["equivalentAppMinutes"] = Math.Round(ticks * 5.0 / 60.0, 1),
                    ["cardsOnScreen"] = inTree.Count,
                    ["expectedClocks"] = expectedClocks,
                    ["estLiveClocks"] = _refInvalidations == lastRefInvalidations ? -1
                        : Math.Round((double)(_clockInvalidations - lastInvalidations) / (_refInvalidations - lastRefInvalidations), 1),
                    ["clockInvalidationsPerSec"] = Math.Round((_clockInvalidations - lastInvalidations) / span, 1),
                    ["renderFps"] = Math.Round((_refInvalidations - lastRefInvalidations) / span, 1),
                    ["cardsCreated"] = _cardsCreated,
                    ["aliveCards"] = alive,
                    ["aliveDiscardedCards"] = aliveDiscarded,
                    ["cpuPercentOneCore"] = Math.Round((cpu - lastCpu).TotalSeconds / span * 100.0, 1),
                    ["privateMB"] = Math.Round(p.PrivateMemorySize64 / 1048576.0, 1),
                    ["managedMB"] = Math.Round(GC.GetTotalMemory(false) / 1048576.0, 1),
                    ["allocatedMBPerSec"] = Math.Round((allocated - lastAllocated) / 1048576.0 / span, 2),
                    ["gcGen0"] = GC.CollectionCount(0),
                    ["gcGen1"] = GC.CollectionCount(1),
                    ["gcGen2"] = GC.CollectionCount(2),
                    ["poolBuiltInWindow"] = poolBuilt - lastPoolBuilt,
                    ["poolReusedInWindow"] = poolReused - lastPoolReused,
                    ["poolRetiredInWindow"] = poolRetired - lastPoolRetired,
                    ["discardedStillAnimated"] = discardedStillAnimated,
                    ["rebuiltUnchangedCards"] = rebuiltUnchangedCards,
                    ["cardsMissingFloat"] = cardsMissingFloat,
                    ["layoutMismatchTicks"] = layoutMismatchTicks,
                    ["keptCardUnloads"] = Interlocked.Read(ref _keptCardUnloads),
                    ["cardsInTreeNotLoaded"] = notLoaded,
                    ["subscriptionLostCards"] = subscriptionLost,
                    ["progressFiringsPerInvoke"] = Interlocked.Read(ref _progressFirings),
                };
                lock (Gate) Samples.Add(row);
                Console.WriteLine($"[{o.Mode}] " + JsonSerializer.Serialize(row));
                lastSampleTicks = ticks;
                lastSampleAt = sw.Elapsed.TotalSeconds;
                lastCpu = Process.GetCurrentProcess().TotalProcessorTime;
                lastInvalidations = _clockInvalidations;
                lastRefInvalidations = _refInvalidations;
                lastAllocated = GC.GetTotalAllocatedBytes(false);
                lastPoolBuilt = poolBuilt;
                lastPoolReused = poolReused;
                lastPoolRetired = poolRetired;
            }

            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(o.TickMs) };
            timer.Tick += (_, _) =>
            {
                int t = ticks++;
                Interlocked.Exchange(ref _lastTickUtc, DateTime.UtcNow.Ticks);
                Advance(t, o);
                bool allView = t % 700 >= 690;
                bool banner = (t / 450) % 2 == 1;
                var models = Ordered(o);
                var before = CardsInTree().ToList();

                if (allView) RenderAllView(pool, o.Mode);
                else if (pool != null) RenderPooled(pool, models, banner);
                else RenderRebuildAll(models, banner, interim: o.Mode == "interim");

                if (pool != null)
                {
                    poolBuilt += pool.Built;
                    poolReused += pool.Reused;
                    poolRetired += pool.Retired;
                }

                var after = CardsInTree().ToList();
                var afterSet = new HashSet<Border>(after);
                foreach (var gone in before)
                    if (!afterSet.Contains(gone) && Mascots.TryGetValue(gone, out var mp) && mp.Float.HasAnimatedProperties)
                        discardedStillAnimated++;
                foreach (var c in after)
                {
                    if (!Mascots.TryGetValue(c, out var mp)) continue;
                    if (!mp.Float.HasAnimatedProperties) cardsMissingFloat++;
                    if (mp.FirstSeenTick < 0) mp.FirstSeenTick = t;
                }

                if (!allView)
                {
                    if (prevCardById != null)
                        foreach (var c in after)
                        {
                            var m = (CardModel)c.Tag;
                            if (prevCardById.TryGetValue(m.Id, out var prev) && Equals(prev.Tag, m) && !ReferenceEquals(prev, c))
                                rebuiltUnchangedCards++;
                        }
                    if (!LayoutMatches(models, banner)) layoutMismatchTicks++;
                    prevCardById = after.ToDictionary(c => ((CardModel)c.Tag).Id);
                }
                else prevCardById = null;

                if (sw.Elapsed.TotalSeconds - lastSampleAt >= o.SampleSeconds) Sample();
                if (sw.Elapsed.TotalSeconds >= o.Seconds)
                {
                    timer.Stop();
                    Sample();
                    lock (Gate)
                    {
                        Totals["uiThreadStalled"] = false;
                        Totals["ticks"] = ticks;
                        Totals["cardsCreated"] = _cardsCreated;
                        Totals["discardedStillAnimated"] = discardedStillAnimated;
                        Totals["rebuiltUnchangedCards"] = rebuiltUnchangedCards;
                        Totals["cardsMissingFloat"] = cardsMissingFloat;
                        Totals["layoutMismatchTicks"] = layoutMismatchTicks;
                        Totals["keptCardUnloads"] = Interlocked.Read(ref _keptCardUnloads);
                        Totals["subscriptionLostCardsLastSample"] = Samples.Count > 0 ? Samples[Samples.Count - 1]["subscriptionLostCards"] : -1;
                    }
                    Write(o);
                    app.Shutdown(0);
                }
            };

            // Watchdog: if the UI thread stops servicing ticks, record that (it IS the hang the issue
            // describes) instead of waiting forever.
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
                    ["items"] = o.Items,
                    ["restart"] = o.Restart,
                    ["forceGc"] = o.ForceGc,
                    ["totals"] = Totals,
                    ["samples"] = Samples,
                };
                File.WriteAllText(o.Out, JsonSerializer.Serialize(doc, new JsonSerializerOptions { WriteIndented = true }));
            }
        }
    }
}

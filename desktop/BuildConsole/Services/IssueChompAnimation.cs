using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using BuildConsole.Controls;

namespace BuildConsole.Services
{
    /// <summary>
    /// Celebratory animation tiers for closing work items:
    /// 1. Single Issue: A random critter rushes in, chomps the card, and bursts it into confetti.
    /// 2. Epic Closed: A LARGE Giant Critter (2.2x scale with golden aura) swoops in for a MEGA CHOMP!
    /// 3. Milestone Closed: A HUGE 5-Critter Parade with balloons, streamers, party hats, and a massive confetti storm!
    /// </summary>
    public static partial class IssueChompAnimation
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TRANSPARENT = 0x00000020;
        private const int WS_EX_TOOLWINDOW = 0x00000080;

        private sealed class OverlaySession
        {
            public Window OverlayWindow { get; set; } = null!;
            public Canvas Canvas { get; set; } = null!;
            private int _closed;

            public void Close()
            {
                if (System.Threading.Interlocked.Exchange(ref _closed, 1) != 0) return; // only decrement once
                System.Threading.Interlocked.Decrement(ref _activeOverlaySessions);
                try
                {
                    OverlayWindow.Close();
                }
                catch { }
            }
        }

        // Shane, 2026-08-28: "maybe too many critters?" — a burst of closed/created/blocked issues
        // (e.g. a big Git Board refresh) used to spawn one Topmost, AllowsTransparency overlay Window
        // PER issue, staggered only 400-700ms apart. Each carries its own DropShadowEffect-heavy
        // critter + a 20-50 particle confetti/spark burst; with several alive at once (each a
        // SEPARATE top-level HWND, not just an element in one window) that repeatedly overwhelmed the
        // WPF composition/render thread hard enough to black-screen and hard-crash the whole process
        // with nothing caught or logged. Capping how many overlay sessions can be alive at once —
        // silently skipping the celebration for anything past the cap rather than piling on — is a
        // direct, cheap fix for that regardless of the exact render-thread failure mode.
        private static int _activeOverlaySessions;
        private const int MaxConcurrentOverlaySessions = 4;

        /// <summary>
        /// Creates a borderless, transparent, topmost overlay Window sized and positioned precisely
        /// over the main window. Because this is a separate top-level Win32 window, it renders completely
        /// ABOVE WebView2 child HWNDs (solving WPF Airspace) without stealing focus or intercepting clicks.
        /// </summary>
        private static OverlaySession? CreateOverlay(Window mainWin, bool clipToBounds = false)
        {
            if (!mainWin.IsLoaded || mainWin.ActualWidth <= 0 || mainWin.ActualHeight <= 0) return null;

            if (_activeOverlaySessions >= MaxConcurrentOverlaySessions)
            {
                ActivityLog.Log("git-board.critters", $"Skipped a critter animation — {_activeOverlaySessions} already on screen (cap {MaxConcurrentOverlaySessions}), avoiding a render-thread pile-up.");
                return null;
            }

            Point screenTopLeft;
            try
            {
                screenTopLeft = mainWin.PointToScreen(new Point(0, 0));
            }
            catch
            {
                screenTopLeft = new Point(mainWin.Left, mainWin.Top);
            }

            var source = PresentationSource.FromVisual(mainWin);
            double dpiX = source?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
            double dpiY = source?.CompositionTarget?.TransformToDevice.M22 ?? 1.0;

            double wpfLeft = screenTopLeft.X / dpiX;
            double wpfTop = screenTopLeft.Y / dpiY;
            double wpfWidth = mainWin.ActualWidth;
            double wpfHeight = mainWin.ActualHeight;

            var canvas = new Canvas
            {
                Width = wpfWidth,
                Height = wpfHeight,
                IsHitTestVisible = false,
                ClipToBounds = clipToBounds,
                Background = Brushes.Transparent,
            };

            var overlayWin = new Window
            {
                WindowStyle = WindowStyle.None,
                AllowsTransparency = true,
                Background = Brushes.Transparent,
                Topmost = true,
                ShowActivated = false,
                ShowInTaskbar = false,
                Focusable = false,
                IsHitTestVisible = false,
                ResizeMode = ResizeMode.NoResize,
                Left = wpfLeft,
                Top = wpfTop,
                Width = wpfWidth,
                Height = wpfHeight,
                Owner = mainWin,
                Content = canvas,
            };

            overlayWin.SourceInitialized += (s, e) =>
            {
                try
                {
                    var hwnd = new WindowInteropHelper(overlayWin).Handle;
                    int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
                    SetWindowLong(hwnd, GWL_EXSTYLE, exStyle | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW);
                }
                catch { }
            };

            try
            {
                overlayWin.Show();
                System.Threading.Interlocked.Increment(ref _activeOverlaySessions);
                return new OverlaySession { OverlayWindow = overlayWin, Canvas = canvas };
            }
            catch
            {
                return null;
            }
        }
        private static readonly Random Rng = new();

        // Shane, 2026-08-28: the 10 new hand-built "good" critters (Controls/BuildQueuePanel's
        // CreateCuteXVector pool, registered as Positive in CritterRegistry.cs) added into the
        // BuildMascot() rotation (Git #1452's slot, now pointing at the replacement mascots) —
        // additive alongside the 5 original hand-built mascots below. Only the Positive-category
        // critters are eligible here: this rotation is for the celebratory build-done/issue-closed
        // chomp, not the "new issue created"/blocked critters used elsewhere (see PlayNewWork/
        // PlayBlocked in IssueChompAnimation.MeanCritters.cs).
        // Lazily computed (not an eager field initializer) — CritterRegistry.BuildAll() reads
        // IssueChompAnimation.MeanCritterPool (declared in IssueChompAnimation.MeanCritters.cs),
        // which is still uninitialized while THIS type's own static cctor is mid-run. Evaluating
        // eagerly here was a circular-static-init bug: MeanCritterPool would still be null when
        // CritterRegistry.All ran, throwing a NullReferenceException that surfaced as "The type
        // initializer for 'IssueChompAnimation' threw an exception." Deferring to first real use
        // means both types have already finished loading by the time this runs.
        private static List<CritterInfo>? _copilotMascotPool;
        private static List<CritterInfo> CopilotMascotPool =>
            _copilotMascotPool ??= CritterRegistry.All.Where(c => c.Category == CritterCategory.Positive).ToList();

        private static readonly Dictionary<string, string> CopilotMascotSounds = new()
        {
            ["panda"] = "MUNCH!",
            ["otter"] = "SPLASH!",
            ["hedgehog"] = "POKE!",
            ["owl"] = "SWOOP!",
            ["seal"] = "BONK!",
            ["raccoon"] = "SNATCH!",
            ["hamster"] = "STUFF!",
            ["frog"] = "RIBBIT!",
            ["koala"] = "SNUGGLE!",
            ["chick"] = "PECK!"
        };

        // Total mascot rotation size — the 5 original hand-built mascots plus every eligible Copilot critter.
        // Callers that need a random index into the FULL rotation (not just the original 5) use this.
        private static int MascotCount => 5 + CopilotMascotPool.Count;

        // Picks `count` distinct mascot indices at random from the full rotation (original 5 + Copilot
        // critters), for the Milestone parade / party-stage variants (Git #1452) — previously these always
        // hardcoded indices 0-4, so the Copilot critters never appeared there.
        private static int[] PickParadeMascotIndices(int count)
        {
            var pool = Enumerable.Range(0, MascotCount).ToList();
            var picked = new int[count];
            for (int i = 0; i < count; i++)
            {
                if (pool.Count == 0) pool = Enumerable.Range(0, MascotCount).ToList(); // wrap if count > MascotCount
                int pick = Rng.Next(pool.Count);
                picked[i] = pool[pick];
                pool.RemoveAt(pick);
            }
            return picked;
        }

        // Wraps a CritterFactory canvas (which ships at its own native size) to the ~60x56 canvas size the
        // 5 original hand-built mascots use, so it reads at a consistent scale in the chomp animation
        // regardless of which native size the Copilot critter was designed at (Git #1452).
        private static FrameworkElement WrapCopilotMascot(Canvas critter, double targetW = 60, double targetH = 56)
        {
            double nativeW = critter.Width > 0 ? critter.Width : targetW;
            double nativeH = critter.Height > 0 ? critter.Height : targetH;
            double scale = Math.Min(targetW / nativeW, targetH / nativeH);

            critter.RenderTransform = new ScaleTransform(scale, scale);
            critter.RenderTransformOrigin = new Point(0, 0);
            Canvas.SetLeft(critter, (targetW - nativeW * scale) / 2);
            Canvas.SetTop(critter, (targetH - nativeH * scale) / 2);

            var wrapper = new Canvas { Width = targetW, Height = targetH };
            wrapper.Children.Add(critter);
            return wrapper;
        }

        private static readonly string[] ChompPhrases =
        {
            "CHOMP!", "OM NOM NOM!", "GULP!", "CRUNCH!", "DELICIOUS BUG!", "ISSUE DEVOURED!", "POOF!", "SNACK TIME!"
        };

        private static readonly string[] EpicPhrases =
        {
            "⚡ MEGA CHOMP!", "💥 EPIC DEVOURED!", "🔥 TITAN CRUNCH!", "👑 EPIC CONQUERED!", "🍽️ FEAST TIME!"
        };

        private static readonly string[] ParadePhrases =
        {
            "🎉 MILESTONE COMPLETED!", "🏆 SUPER VICTORY!", "🥳 PARADE TIME!", "🎊 MISSION ACCOMPLISHED!", "✨ WOOHOO!"
        };

        private static readonly string[] WhammyPhrases =
        {
            "🛑 NO WHAMMY! STOP!",
            "🔨 WHAMMY SMASH! BLOCKED!",
            "🚫 NO WHAMMY, NO WHAMMY!",
            "🛑 WHAMMY SAYS NO!",
            "💥 BLOCKED BY WHAMMY!",
            "😈 HEHEHE! BLOCKED!"
        };

        private static readonly Color[] ConfettiColors =
        {
            Color.FromRgb(0xFA, 0xB3, 0x87), // Peach
            Color.FromRgb(0xA6, 0xE3, 0xA1), // Green
            Color.FromRgb(0x89, 0xB4, 0xFA), // Blue
            Color.FromRgb(0xF9, 0xE2, 0xAF), // Yellow
            Color.FromRgb(0xCB, 0xA6, 0xF7), // Mauve
            Color.FromRgb(0xF3, 0x8B, 0xA8), // Red
            Color.FromRgb(0x94, 0xE2, 0xD5), // Teal
        };

        // ══════════════════════════════════════════════════════════════════════
        // 1. STANDARD ISSUE CHOMP (Single Critter)
        // ══════════════════════════════════════════════════════════════════════
        public static void Play(FrameworkElement? targetElement, string issueTitle)
        {
            PlayInternal(targetElement, issueTitle, isEpic: false);
        }

        // ══════════════════════════════════════════════════════════════════════
        // 2. LARGE EPIC CHOMP (Giant Critter, Gold Aura, Mega Burst)
        // ══════════════════════════════════════════════════════════════════════
        public static void PlayEpic(FrameworkElement? targetElement, string epicTitle)
        {
            PlayInternal(targetElement, epicTitle, isEpic: true);
        }

        private static int _critterSpawnSeq;
        private static DateTime _lastCritterSpawnTime = DateTime.MinValue;

        // Rich distribution of target coordinates across the ENTIRE window (top-left, center, top-right, bottom-left, bottom-right, etc.)
        private static readonly (double xRatio, double yRatio)[] SpreadZones =
        {
            (0.30, 0.22), // Top-Left
            (0.72, 0.25), // Top-Right
            (0.48, 0.38), // Mid-Center
            (0.26, 0.54), // Mid-Left
            (0.74, 0.50), // Mid-Right
            (0.52, 0.68), // Bottom-Center
            (0.32, 0.76), // Bottom-Left
            (0.70, 0.74), // Bottom-Right
            (0.52, 0.20), // Center-Top
            (0.40, 0.46), // Center-Left
            (0.62, 0.34), // Upper-Mid-Right
            (0.36, 0.62), // Lower-Mid-Left
        };

        internal static (Point targetPos, int seq) ComputeSpreadTargetPositionWithSeq(Window mainWin, FrameworkElement? targetElement, bool isEpic)
        {
            var now = DateTime.UtcNow;
            if ((now - _lastCritterSpawnTime).TotalSeconds > 8)
            {
                _critterSpawnSeq = 0; // reset sequence after pause
            }
            _lastCritterSpawnTime = now;
            int seq = _critterSpawnSeq++;

            var zone = SpreadZones[seq % SpreadZones.Length];
            double jitterX = (Rng.NextDouble() - 0.5) * 60;
            double jitterY = (Rng.NextDouble() - 0.5) * 45;

            double targetX = (mainWin.ActualWidth * zone.xRatio) + jitterX;
            double targetY = (mainWin.ActualHeight * zone.yRatio) + jitterY;

            // If a single targetElement was provided and it's not part of a rapid multi-spawn (seq == 0),
            // we can place it near the element's Y, but still ensure X is out in the open view area.
            if (targetElement != null && targetElement.IsLoaded && seq == 0)
            {
                try
                {
                    var screenPoint = targetElement.PointToScreen(new Point(targetElement.ActualWidth / 2, targetElement.ActualHeight / 2));
                    var elementPoint = mainWin.PointFromScreen(screenPoint);
                    targetY = elementPoint.Y;
                    targetX = Math.Max(targetX, elementPoint.X + 60);
                }
                catch { }
            }

            double minX = isEpic ? 140 : 120;
            double maxX = Math.Max(minX + 40, mainWin.ActualWidth - (isEpic ? 220 : 180));
            double minY = isEpic ? 90 : 70;
            double maxY = Math.Max(minY + 40, mainWin.ActualHeight - (isEpic ? 130 : 110));

            return (new Point(Math.Clamp(targetX, minX, maxX), Math.Clamp(targetY, minY, maxY)), seq);
        }

        internal static Point ComputeSpreadTargetPosition(Window mainWin, FrameworkElement? targetElement, bool isEpic)
        {
            return ComputeSpreadTargetPositionWithSeq(mainWin, targetElement, isEpic).targetPos;
        }

        private static void PlayInternal(FrameworkElement? targetElement, string title, bool isEpic)
        {
            if (Application.Current?.MainWindow is not Window mainWin) return;

            mainWin.Dispatcher.Invoke(() =>
            {
                try
                {
                    var session = CreateOverlay(mainWin, clipToBounds: false);
                    if (session == null) return;
                    var canvas = session.Canvas;

                    var (targetPos, seq) = ComputeSpreadTargetPositionWithSeq(mainWin, targetElement, isEpic);

                    // Floating target card
                    var issueCard = new Border
                    {
                        Background = new SolidColorBrush(Color.FromRgb(0x31, 0x32, 0x44)),
                        BorderBrush = new SolidColorBrush(isEpic ? Color.FromRgb(0xF9, 0xE2, 0xAF) : Color.FromRgb(0x89, 0xB4, 0xFA)),
                        BorderThickness = new Thickness(isEpic ? 2.5 : 1.5),
                        CornerRadius = new CornerRadius(isEpic ? 8 : 6),
                        Padding = new Thickness(isEpic ? 14 : 10, isEpic ? 8 : 6, isEpic ? 14 : 10, isEpic ? 8 : 6),
                        Effect = new DropShadowEffect
                        {
                            BlurRadius = isEpic ? 24 : 14,
                            ShadowDepth = 2,
                            Opacity = 0.7,
                            Color = isEpic ? Color.FromRgb(0xFA, 0xB3, 0x87) : Colors.Black
                        },
                        RenderTransformOrigin = new Point(0.5, 0.5)
                    };
                    var cardTransform = new TransformGroup();
                    var cardScale = new ScaleTransform(1, 1);
                    var cardRotate = new RotateTransform(0);
                    cardTransform.Children.Add(cardScale);
                    cardTransform.Children.Add(cardRotate);
                    issueCard.RenderTransform = cardTransform;

                    var cardText = new TextBlock
                    {
                        Text = (isEpic ? "⚡ " : "") + (title.Length > 32 ? title.Substring(0, 29) + "…" : title),
                        Foreground = new SolidColorBrush(isEpic ? Color.FromRgb(0xF9, 0xE2, 0xAF) : Color.FromRgb(0xCD, 0xD6, 0xF4)),
                        FontSize = isEpic ? 13 : 11.5,
                        FontWeight = FontWeights.Bold
                    };
                    issueCard.Child = cardText;

                    Canvas.SetLeft(issueCard, targetPos.X - (isEpic ? 80 : 60));
                    Canvas.SetTop(issueCard, targetPos.Y - (isEpic ? 20 : 15));
                    canvas.Children.Add(issueCard);

                    // Mascot Selection — full rotation, original 5 + eligible Copilot critters (Git #1452)
                    int charIndex = Rng.Next(MascotCount);
                    var (character, _) = BuildMascot(charIndex);

                    if (isEpic)
                    {
                        // Giant scale & gold aura for Epic
                        character.Effect = new DropShadowEffect
                        {
                            Color = Color.FromRgb(0xF9, 0xE2, 0xAF),
                            BlurRadius = 28,
                            ShadowDepth = 0,
                            Opacity = 0.9
                        };
                    }

                    double critterScale = isEpic ? 2.2 : 1.1;
                    double winW = mainWin.ActualWidth;

                    // Alternate entry from Left or Right based on target quadrant / sequence
                    bool enterFromLeft = (targetPos.X > winW * 0.52) || (seq % 2 == 1);
                    double startX = enterFromLeft ? -50 : (winW + 50);
                    double startY = targetPos.Y - (isEpic ? 45 : 25);
                    Canvas.SetLeft(character, startX);
                    Canvas.SetTop(character, startY);
                    canvas.Children.Add(character);

                    var charTransform = new TransformGroup();
                    var charTranslate = new TranslateTransform();
                    var charHopTranslate = new TranslateTransform();
                    // Face direction of sprint (+ScaleX faces right, -ScaleX faces left)
                    var charScaleTransform = new ScaleTransform(enterFromLeft ? critterScale : -critterScale, critterScale);
                    charTransform.Children.Add(charScaleTransform);
                    charTransform.Children.Add(charTranslate);
                    charTransform.Children.Add(charHopTranslate);
                    character.RenderTransform = charTransform;
                    character.RenderTransformOrigin = new Point(0.5, 0.5);

                    // Speech bubble
                    var bubble = new Border
                    {
                        Background = new SolidColorBrush(isEpic ? Color.FromRgb(0xF9, 0xE2, 0xAF) : Color.FromRgb(0xFA, 0xB3, 0x87)),
                        BorderBrush = new SolidColorBrush(isEpic ? Color.FromRgb(0xFA, 0xB3, 0x87) : Colors.Transparent),
                        BorderThickness = new Thickness(isEpic ? 2 : 0),
                        CornerRadius = new CornerRadius(14),
                        Padding = new Thickness(isEpic ? 12 : 8, isEpic ? 6 : 4, isEpic ? 12 : 8, isEpic ? 6 : 4),
                        Opacity = 0,
                        RenderTransformOrigin = new Point(0.5, 0.5)
                    };
                    var bubbleScale = new ScaleTransform(0.2, 0.2);
                    bubble.RenderTransform = bubbleScale;
                    var bubbleText = new TextBlock
                    {
                        Text = isEpic ? EpicPhrases[Rng.Next(EpicPhrases.Length)] : ChompPhrases[Rng.Next(ChompPhrases.Length)],
                        Foreground = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                        FontSize = isEpic ? 13 : 11,
                        FontWeight = FontWeights.ExtraBold
                    };
                    bubble.Child = bubbleText;
                    Canvas.SetLeft(bubble, targetPos.X - (isEpic ? 60 : 40));
                    Canvas.SetTop(bubble, targetPos.Y - (isEpic ? 75 : 55));
                    canvas.Children.Add(bubble);

                    // Step 1: Sprint across the screen to target position
                    double targetArrivalX = enterFromLeft ? (targetPos.X - (isEpic ? 35 : 25)) : (targetPos.X + (isEpic ? 35 : 25));
                    double sprintDistance = targetArrivalX - startX;
                    int sprintDuration = isEpic ? 1800 : 1500;

                    var sprintX = new DoubleAnimation(0, sprintDistance, TimeSpan.FromMilliseconds(sprintDuration))
                    {
                        EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                    };
                    charTranslate.BeginAnimation(TranslateTransform.XProperty, sprintX);

                    // Gallop / Bouncing hop while sprinting across the screen
                    var hop = new DoubleAnimation(0, -18, TimeSpan.FromMilliseconds(180))
                    {
                        AutoReverse = true,
                        RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(sprintDuration)),
                        EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                    };
                    charHopTranslate.BeginAnimation(TranslateTransform.YProperty, hop);

                    // Step 2: Speech bubble pop right when arriving at the issue
                    int bubblePopDelay = Math.Max(100, sprintDuration - 200);
                    var popOpacity = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200)) { BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay) };
                    var popScale = new DoubleAnimation(0.2, isEpic ? 1.35 : 1.15, TimeSpan.FromMilliseconds(250))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay),
                        EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 4 }
                    };
                    bubble.BeginAnimation(UIElement.OpacityProperty, popOpacity);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleXProperty, popScale);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleYProperty, popScale);

                    // Step 3: Crunch & Burst on arrival (lingers briefly at card so it's readable)
                    int crunchDelay = sprintDuration + 350;
                    var crunchTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(crunchDelay) };
                    crunchTimer.Tick += (_, _) =>
                    {
                        crunchTimer.Stop();

                        var shrink = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(250))
                        {
                            EasingFunction = new BackEase { Amplitude = 2.5, EasingMode = EasingMode.EaseIn }
                        };
                        cardScale.BeginAnimation(ScaleTransform.ScaleXProperty, shrink);
                        cardScale.BeginAnimation(ScaleTransform.ScaleYProperty, shrink);

                        var gulp = new DoubleAnimation(critterScale, critterScale * 1.4, TimeSpan.FromMilliseconds(200))
                        {
                            AutoReverse = true,
                            EasingFunction = new BounceEase { Bounces = 1, Bounciness = 2 }
                        };
                        charScaleTransform.BeginAnimation(ScaleTransform.ScaleYProperty, gulp);

                        SpawnConfettiBurst(canvas, targetPos, isEpic ? 45 : 22, isEpic);
                    };
                    crunchTimer.Start();

                    // Step 4: Victory exit (continue dashing forward off the screen after lingering)
                    int exitDelay = sprintDuration + 1800;
                    var exitTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(exitDelay) };
                    exitTimer.Tick += (_, _) =>
                    {
                        exitTimer.Stop();

                        double exitDistance = enterFromLeft
                            ? (sprintDistance + (winW - targetPos.X + 250))
                            : (sprintDistance - (targetPos.X + 250));

                        var exitX = new DoubleAnimation(sprintDistance, exitDistance, TimeSpan.FromMilliseconds(1100))
                        {
                            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
                        };
                        var exitFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(600))
                        {
                            BeginTime = TimeSpan.FromMilliseconds(500)
                        };
                        charTranslate.BeginAnimation(TranslateTransform.XProperty, exitX);
                        character.BeginAnimation(UIElement.OpacityProperty, exitFade);
                        bubble.BeginAnimation(UIElement.OpacityProperty, exitFade);
                    };
                    exitTimer.Start();

                    // Step 5: Clean up canvas
                    int totalDuration = exitDelay + 1300;
                    var cleanupTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(totalDuration) };
                    cleanupTimer.Tick += (_, _) =>
                    {
                        cleanupTimer.Stop();
                        session.Close();
                    };
                    cleanupTimer.Start();
                }
                catch { }
            });
        }

        // ══════════════════════════════════════════════════════════════════════
        // 3. HUGE MILESTONE PARADE & BIG PARTY (All 5 Critters, Streamers & Party)
        // ══════════════════════════════════════════════════════════════════════
        public static void PlayMilestoneParade(FrameworkElement? targetElement, string milestoneTitle)
        {
            if (Application.Current?.MainWindow is not Window mainWin) return;

            mainWin.Dispatcher.Invoke(() =>
            {
                try
                {
                    var session = CreateOverlay(mainWin, clipToBounds: false);
                    if (session == null) return;
                    var canvas = session.Canvas;
                    double winW = mainWin.ActualWidth;
                    double winH = mainWin.ActualHeight;

                    // 1. Grand Center Milestone Banner
                    var banner = new Border
                    {
                        Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E)),
                        BorderBrush = new LinearGradientBrush(
                            Color.FromRgb(0xFA, 0xB3, 0x87),
                            Color.FromRgb(0xCB, 0xA6, 0xF7),
                            new Point(0, 0),
                            new Point(1, 1)),
                        BorderThickness = new Thickness(3),
                        CornerRadius = new CornerRadius(14),
                        Padding = new Thickness(24, 14, 24, 14),
                        Effect = new DropShadowEffect
                        {
                            Color = Color.FromRgb(0xF9, 0xE2, 0xAF),
                            BlurRadius = 36,
                            ShadowDepth = 0,
                            Opacity = 0.95
                        },
                        RenderTransformOrigin = new Point(0.5, 0.5)
                    };
                    var bannerTransform = new TransformGroup();
                    var bannerScale = new ScaleTransform(0.2, 0.2);
                    bannerTransform.Children.Add(bannerScale);
                    banner.RenderTransform = bannerTransform;

                    var bannerStack = new StackPanel { Orientation = Orientation.Vertical, HorizontalAlignment = HorizontalAlignment.Center };
                    bannerStack.Children.Add(new TextBlock
                    {
                        Text = "🎯 MILESTONE CONQUERED! 🏆",
                        FontSize = 18,
                        FontWeight = FontWeights.Black,
                        Foreground = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                        HorizontalAlignment = HorizontalAlignment.Center
                    });
                    bannerStack.Children.Add(new TextBlock
                    {
                        Text = milestoneTitle,
                        FontSize = 14,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                        Margin = new Thickness(0, 4, 0, 0),
                        HorizontalAlignment = HorizontalAlignment.Center
                    });
                    banner.Child = bannerStack;

                    Canvas.SetLeft(banner, winW / 2 - 160);
                    Canvas.SetTop(banner, winH * 0.28);
                    canvas.Children.Add(banner);

                    // Animate banner pop in
                    var bannerPop = new DoubleAnimation(0.2, 1.15, TimeSpan.FromMilliseconds(400))
                    {
                        EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 3 }
                    };
                    bannerScale.BeginAnimation(ScaleTransform.ScaleXProperty, bannerPop);
                    bannerScale.BeginAnimation(ScaleTransform.ScaleYProperty, bannerPop);

                    // 2. Spawn All 5 Mascots in a Marching Parade Line — drawn from the full rotation
                    // (original 5 + Copilot critters, Git #1452), not just hardcoded indices 0-4.
                    double paradeY = winH * 0.55;
                    var paradeMascots = new List<(FrameworkElement Critter, TranslateTransform Trans, ScaleTransform Scale)>();
                    int[] paradeIndices = PickParadeMascotIndices(5);

                    for (int i = 0; i < 5; i++)
                    {
                        var (critter, _) = BuildMascot(paradeIndices[i]);

                        // Attach party decoration (balloon or party hat emoji above head)
                        var decor = new TextBlock
                        {
                            Text = (i == 0) ? "👑" : ((i == 1) ? "🎈" : ((i == 2) ? "🎉" : ((i == 3) ? "🎺" : "⭐"))),
                            FontSize = 16,
                            Margin = new Thickness(20, -18, 0, 0)
                        };
                        if (critter is Canvas c) c.Children.Add(decor);

                        var transGroup = new TransformGroup();
                        var transX = new TranslateTransform();
                        // Face LEFT (right-to-left parade)
                        var scale = new ScaleTransform(-1.6, 1.6);
                        transGroup.Children.Add(scale);
                        transGroup.Children.Add(transX);
                        critter.RenderTransform = transGroup;
                        critter.RenderTransformOrigin = new Point(0.5, 0.5);

                        double startPosX = winW + 120 + (i * 90);
                        Canvas.SetLeft(critter, startPosX);
                        Canvas.SetTop(critter, paradeY);
                        canvas.Children.Add(critter);

                        paradeMascots.Add((critter, transX, scale));

                        // March across animation (Right to Left) — slowed down for grand parade
                        var march = new DoubleAnimation(0, -(winW + 300 + (i * 90)), TimeSpan.FromMilliseconds(5500))
                        {
                            BeginTime = TimeSpan.FromMilliseconds(i * 180)
                        };
                        transX.BeginAnimation(TranslateTransform.XProperty, march);

                        // Bouncing hop while marching
                        var hop = new DoubleAnimation(1.6, 2.0, TimeSpan.FromMilliseconds(240))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(5200)),
                            BeginTime = TimeSpan.FromMilliseconds(i * 180),
                            EasingFunction = new BounceEase { Bounces = 1, Bounciness = 2 }
                        };
                        scale.BeginAnimation(ScaleTransform.ScaleYProperty, hop);
                    }

                    // 3. Huge Party Confetti & Fireworks Storm
                    for (int wave = 0; wave < 3; wave++)
                    {
                        var waveTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(wave * 600 + 200) };
                        waveTimer.Tick += (_, _) =>
                        {
                            waveTimer.Stop();
                            Point centerPoint = new Point(winW * (0.25 + (Rng.NextDouble() * 0.5)), winH * 0.35);
                            SpawnConfettiBurst(canvas, centerPoint, 35, isEpic: true);
                        };
                        waveTimer.Start();
                    }

                    // 4. Milestone Banner Crunch by Lead Mascot (around 2200ms)
                    var bannerChompTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(2200) };
                    bannerChompTimer.Tick += (_, _) =>
                    {
                        bannerChompTimer.Stop();

                        var bannerShrink = new DoubleAnimation(1.15, 0, TimeSpan.FromMilliseconds(350))
                        {
                            EasingFunction = new BackEase { Amplitude = 2, EasingMode = EasingMode.EaseIn }
                        };
                        bannerScale.BeginAnimation(ScaleTransform.ScaleXProperty, bannerShrink);
                        bannerScale.BeginAnimation(ScaleTransform.ScaleYProperty, bannerShrink);

                        SpawnConfettiBurst(canvas, new Point(winW / 2, winH * 0.32), 50, isEpic: true);
                    };
                    bannerChompTimer.Start();

                    // 5. Cleanup
                    var cleanupTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(6500) };
                    cleanupTimer.Tick += (_, _) =>
                    {
                        cleanupTimer.Stop();
                        session.Close();
                    };
                    cleanupTimer.Start();
                }
                catch { }
            });
        }

        // ══════════════════════════════════════════════════════════════════════
        // 4. WHAMMY SLAM (Blocked Issue Animation)
        // ══════════════════════════════════════════════════════════════════════
        // Shane, 2026-08-28: "10 mean critters like my Whammy critter who creates
        // blockers." mascotBuilder lets IssueChompAnimation.MeanCritters.cs's
        // PlayBlocked() drop any of its 10 new mean mascots through this EXACT
        // same charge-in/windup/slam/spark choreography — defaults to the
        // classic Whammy so every existing caller is untouched.
        public static void PlayWhammy(FrameworkElement? targetElement, string issueTitle, int? blockerNumber = null,
            Func<(FrameworkElement element, RotateTransform propTransform)>? mascotBuilder = null)
        {
            if (Application.Current?.MainWindow is not Window mainWin) return;

            mainWin.Dispatcher.Invoke(() =>
            {
                try
                {
                    var session = CreateOverlay(mainWin, clipToBounds: false);
                    if (session == null) return;
                    var canvas = session.Canvas;

                    Point targetPos = ComputeSpreadTargetPosition(mainWin, targetElement, isEpic: false);

                    // Floating target card with red blocked border
                    var issueCard = new Border
                    {
                        Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E)),
                        BorderBrush = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                        BorderThickness = new Thickness(2),
                        CornerRadius = new CornerRadius(8),
                        Padding = new Thickness(14, 8, 14, 8),
                        Effect = new DropShadowEffect
                        {
                            BlurRadius = 20,
                            ShadowDepth = 2,
                            Opacity = 0.8,
                            Color = Color.FromRgb(0xF3, 0x8B, 0xA8)
                        },
                        RenderTransformOrigin = new Point(0.5, 0.5)
                    };
                    var cardTransform = new TransformGroup();
                    var cardScale = new ScaleTransform(1, 1);
                    var cardTranslate = new TranslateTransform();
                    cardTransform.Children.Add(cardScale);
                    cardTransform.Children.Add(cardTranslate);
                    issueCard.RenderTransform = cardTransform;

                    var cardStack = new StackPanel();
                    var cardText = new TextBlock
                    {
                        Text = issueTitle.Length > 34 ? issueTitle.Substring(0, 31) + "…" : issueTitle,
                        Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                        FontSize = 12.5,
                        FontWeight = FontWeights.Bold
                    };
                    cardStack.Children.Add(cardText);

                    if (blockerNumber.HasValue)
                    {
                        var blockerText = new TextBlock
                        {
                            Text = $"Blocked by #{blockerNumber.Value}",
                            Foreground = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                            FontSize = 10.5,
                            FontWeight = FontWeights.SemiBold,
                            Margin = new Thickness(0, 2, 0, 0)
                        };
                        cardStack.Children.Add(blockerText);
                    }

                    issueCard.Child = cardStack;

                    Canvas.SetLeft(issueCard, targetPos.X - 70);
                    Canvas.SetTop(issueCard, targetPos.Y - 20);
                    canvas.Children.Add(issueCard);

                    // Whammy Mascot with articulated sledgehammer — or whichever mean
                    // mascot PlayBlocked() picked, same (element, swung-prop) contract.
                    var (whammy, malletTransform) = (mascotBuilder ?? BuildWhammyMascot)();

                    whammy.Effect = new DropShadowEffect
                    {
                        Color = Color.FromRgb(0xF3, 0x8B, 0xA8),
                        BlurRadius = 22,
                        ShadowDepth = 0,
                        Opacity = 0.85
                    };

                    double whammyScale = 1.9;
                    var charTransform = new TransformGroup();
                    var charTranslate = new TranslateTransform();
                    var charHopTranslate = new TranslateTransform();
                    // Face LEFT (starts on far right over Build Queue panel, charges left across tabs to the left sidebar)
                    var charScaleTransform = new ScaleTransform(-whammyScale, whammyScale);
                    charTransform.Children.Add(charScaleTransform);
                    charTransform.Children.Add(charTranslate);
                    charTransform.Children.Add(charHopTranslate);
                    whammy.RenderTransform = charTransform;
                    whammy.RenderTransformOrigin = new Point(0.5, 0.5);

                    // Start at the far RIGHT of the window (over the Build Queue panel)
                    double winW = mainWin.ActualWidth;
                    double startX = winW + 40;
                    double startY = targetPos.Y - 45;
                    Canvas.SetLeft(whammy, startX);
                    Canvas.SetTop(whammy, startY);
                    canvas.Children.Add(whammy);

                    // Speech bubble with NO WHAMMY!
                    var bubble = new Border
                    {
                        Background = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                        BorderBrush = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                        BorderThickness = new Thickness(1.5),
                        CornerRadius = new CornerRadius(12),
                        Padding = new Thickness(12, 6, 12, 6),
                        Opacity = 0,
                        RenderTransformOrigin = new Point(0.5, 0.5)
                    };
                    var bubbleScale = new ScaleTransform(0.2, 0.2);
                    bubble.RenderTransform = bubbleScale;
                    var bubbleText = new TextBlock
                    {
                        Text = WhammyPhrases[Rng.Next(WhammyPhrases.Length)],
                        Foreground = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                        FontSize = 12.5,
                        FontWeight = FontWeights.Black
                    };
                    bubble.Child = bubbleText;
                    Canvas.SetLeft(bubble, targetPos.X - 45);
                    Canvas.SetTop(bubble, targetPos.Y - 70);
                    canvas.Children.Add(bubble);

                    // Step 1: Whammy charges across the ENTIRE screen (from right Build Queue panel across main tabs to left issue)
                    double targetArrivalX = targetPos.X + 45;
                    double chargeDistance = targetArrivalX - startX;
                    int chargeDuration = 1600;

                    var chargeX = new DoubleAnimation(0, chargeDistance, TimeSpan.FromMilliseconds(chargeDuration))
                    {
                        EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                    };
                    charTranslate.BeginAnimation(TranslateTransform.XProperty, chargeX);

                    // Heavy stomping bounce while charging across the screen
                    var stomp = new DoubleAnimation(0, -16, TimeSpan.FromMilliseconds(180))
                    {
                        AutoReverse = true,
                        RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(chargeDuration)),
                        EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                    };
                    charHopTranslate.BeginAnimation(TranslateTransform.YProperty, stomp);

                    // Step 2: Speech bubble pop right when arriving
                    int bubblePopDelay = Math.Max(100, chargeDuration - 200);
                    var popOpacity = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(180)) { BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay) };
                    var popScale = new DoubleAnimation(0.2, 1.2, TimeSpan.FromMilliseconds(240))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay),
                        EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 4 }
                    };
                    bubble.BeginAnimation(UIElement.OpacityProperty, popOpacity);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleXProperty, popScale);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleYProperty, popScale);

                    // Step 3: Mallet Windup & Heavy SLAM!
                    var malletWindup = new DoubleAnimation(0, 45, TimeSpan.FromMilliseconds(320))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay),
                        EasingFunction = new BackEase { Amplitude = 1.2, EasingMode = EasingMode.EaseIn }
                    };
                    malletTransform.BeginAnimation(RotateTransform.AngleProperty, malletWindup);

                    var slamTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(chargeDuration + 200) };
                    slamTimer.Tick += (_, _) =>
                    {
                        slamTimer.Stop();

                        // Mallet slams down hard (-75 deg)
                        var malletSlam = new DoubleAnimation(45, -75, TimeSpan.FromMilliseconds(180))
                        {
                            EasingFunction = new BounceEase { Bounces = 1, Bounciness = 3 }
                        };
                        malletTransform.BeginAnimation(RotateTransform.AngleProperty, malletSlam);

                        // Card Impact Shock & Jitter
                        var cardJitterX = new DoubleAnimation(0, -8, TimeSpan.FromMilliseconds(50))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(4)
                        };
                        var cardJitterY = new DoubleAnimation(0, 6, TimeSpan.FromMilliseconds(50))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(4)
                        };
                        cardTranslate.BeginAnimation(TranslateTransform.XProperty, cardJitterX);
                        cardTranslate.BeginAnimation(TranslateTransform.YProperty, cardJitterY);

                        // Comic "🚫 BLOCKED!" Stamp appears on the card
                        var stamp = new Border
                        {
                            Background = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                            CornerRadius = new CornerRadius(5),
                            Padding = new Thickness(8, 3, 8, 3),
                            BorderBrush = Brushes.White,
                            BorderThickness = new Thickness(1.5),
                            RenderTransformOrigin = new Point(0.5, 0.5),
                            HorizontalAlignment = HorizontalAlignment.Center,
                            Margin = new Thickness(0, 6, 0, 0)
                        };
                        var stampScale = new ScaleTransform(2.5, 2.5);
                        stamp.RenderTransform = stampScale;
                        stamp.Child = new TextBlock
                        {
                            Text = "🚫 BLOCKED!",
                            FontWeight = FontWeights.Black,
                            FontSize = 11,
                            Foreground = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B))
                        };
                        cardStack.Children.Add(stamp);

                        var stampDrop = new DoubleAnimation(2.5, 1.0, TimeSpan.FromMilliseconds(220))
                        {
                            EasingFunction = new BounceEase { Bounces = 1, Bounciness = 2 }
                        };
                        stampScale.BeginAnimation(ScaleTransform.ScaleXProperty, stampDrop);
                        stampScale.BeginAnimation(ScaleTransform.ScaleYProperty, stampDrop);

                        // Impact Sparks & Warning icons
                        SpawnWhammySparks(canvas, new Point(targetPos.X + 20, targetPos.Y + 10));
                    };
                    slamTimer.Start();

                    // Step 4: Mischievous Laugh & Dash off to the LEFT (lingers for a moment)
                    int exitDelay = chargeDuration + 1800;
                    var exitTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(exitDelay) };
                    exitTimer.Tick += (_, _) =>
                    {
                        exitTimer.Stop();

                        bubbleText.Text = "HEHEHE! 😈";

                        double exitDistance = chargeDistance - (targetPos.X + 250);
                        var exitX = new DoubleAnimation(chargeDistance, exitDistance, TimeSpan.FromMilliseconds(1100))
                        {
                            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
                        };
                        var exitFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(600))
                        {
                            BeginTime = TimeSpan.FromMilliseconds(400)
                        };
                        charTranslate.BeginAnimation(TranslateTransform.XProperty, exitX);
                        whammy.BeginAnimation(UIElement.OpacityProperty, exitFade);
                        bubble.BeginAnimation(UIElement.OpacityProperty, exitFade);
                    };
                    exitTimer.Start();

                    // Step 5: Clean up
                    int totalDuration = exitDelay + 1300;
                    var cleanupTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(totalDuration) };
                    cleanupTimer.Tick += (_, _) =>
                    {
                        cleanupTimer.Stop();
                        session.Close();
                    };
                    cleanupTimer.Start();
                }
                catch { }
            });
        }

        private static void SpawnConfettiBurst(Canvas canvas, Point center, int particleCount = 22, bool isEpic = false)
        {
            for (int i = 0; i < particleCount; i++)
            {
                double angle = (i / (double)particleCount) * 2 * Math.PI + (Rng.NextDouble() * 0.4 - 0.2);
                double speed = Rng.Next(isEpic ? 80 : 50, isEpic ? 220 : 130);
                double destX = center.X + Math.Cos(angle) * speed;
                double destY = center.Y + Math.Sin(angle) * speed;

                var color = ConfettiColors[Rng.Next(ConfettiColors.Length)];
                FrameworkElement particle;

                if (i % 3 == 0)
                {
                    particle = new TextBlock
                    {
                        Text = (i % 6 == 0) ? "✨" : ((i % 6 == 3) ? "⭐" : (isEpic ? "🏆" : "💥")),
                        FontSize = Rng.Next(isEpic ? 14 : 11, isEpic ? 22 : 16),
                        Opacity = 1
                    };
                }
                else
                {
                    particle = new Border
                    {
                        Width = Rng.Next(isEpic ? 8 : 6, isEpic ? 18 : 12),
                        Height = Rng.Next(4, isEpic ? 9 : 7),
                        Background = new SolidColorBrush(color),
                        CornerRadius = new CornerRadius(2)
                    };
                }

                var trans = new TranslateTransform();
                particle.RenderTransform = trans;

                Canvas.SetLeft(particle, center.X);
                Canvas.SetTop(particle, center.Y);
                canvas.Children.Add(particle);

                var animX = new DoubleAnimation(0, destX - center.X, TimeSpan.FromMilliseconds(isEpic ? 750 : 500))
                {
                    EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut }
                };
                var animY = new DoubleAnimation(0, destY - center.Y + (isEpic ? 35 : 20), TimeSpan.FromMilliseconds(isEpic ? 850 : 550))
                {
                    EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut }
                };
                var fade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(isEpic ? 750 : 500))
                {
                    BeginTime = TimeSpan.FromMilliseconds(isEpic ? 250 : 150)
                };

                trans.BeginAnimation(TranslateTransform.XProperty, animX);
                trans.BeginAnimation(TranslateTransform.YProperty, animY);
                particle.BeginAnimation(UIElement.OpacityProperty, fade);
            }
        }

        private static (FrameworkElement element, string sound) BuildMascot(int type)
        {
            switch (type)
            {
                case 0: // 🦊 Fox Mascot
                    return (BuildFoxMascot(), "YUM!");
                case 1: // 🐻 Bear Mascot
                    return (BuildBearMascot(), "GULP!");
                case 2: // 🐱 Purple Cat
                    return (BuildCatMascot(), "CRUNCH!");
                case 3: // 🐦 Scout Bird
                    return (BuildBirdMascot(), "PECK!");
                case 4: // 🦆 Sprocket Runner
                    return (BuildSprocketMascot(), "CHOMP!");
                default:
                    // Copilot-designed critters (#1435/#1452) fill out the rest of the rotation.
                    int copilotIndex = type - 5;
                    if (copilotIndex < 0 || copilotIndex >= CopilotMascotPool.Count)
                        return (BuildSprocketMascot(), "CHOMP!"); // out-of-range fallback, never crash the animation

                    var info = CopilotMascotPool[copilotIndex];
                    string sound = CopilotMascotSounds.TryGetValue(info.Id, out var s) ? s : "NOM!";
                    ActivityLog.Log("git-board.critters", $"Copilot critter '{info.Name}' ({info.Id}) selected for build-done chomp — {sound}");
                    return (WrapCopilotMascot(info.Factory()), sound);
            }
        }

        private static FrameworkElement BuildFoxMascot()
        {
            var canvas = new Canvas { Width = 64, Height = 56 };

            var head = new Path
            {
                Fill = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                Data = Geometry.Parse("M 10,24 Q 4,6 18,12 Q 32,18 46,12 Q 60,6 54,24 Q 58,44 32,52 Q 6,44 10,24 Z")
            };
            canvas.Children.Add(head);

            var muzzle = new Ellipse { Width = 26, Height = 18, Fill = new SolidColorBrush(Color.FromRgb(0xF5, 0xE0, 0xDC)) };
            Canvas.SetLeft(muzzle, 19);
            Canvas.SetTop(muzzle, 28);
            canvas.Children.Add(muzzle);

            var nose = new Ellipse { Width = 8, Height = 5, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(nose, 28);
            Canvas.SetTop(nose, 30);
            canvas.Children.Add(nose);

            var leftEye = new Ellipse { Width = 5, Height = 6, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            var rightEye = new Ellipse { Width = 5, Height = 6, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(leftEye, 20);
            Canvas.SetTop(leftEye, 22);
            Canvas.SetLeft(rightEye, 39);
            Canvas.SetTop(rightEye, 22);
            canvas.Children.Add(leftEye);
            canvas.Children.Add(rightEye);

            return canvas;
        }

        private static FrameworkElement BuildBearMascot()
        {
            var canvas = new Canvas { Width = 60, Height = 56 };

            var earL = new Ellipse { Width = 14, Height = 14, Fill = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)) };
            Canvas.SetLeft(earL, 6);
            Canvas.SetTop(earL, 4);
            canvas.Children.Add(earL);

            var earR = new Ellipse { Width = 14, Height = 14, Fill = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)) };
            Canvas.SetLeft(earR, 40);
            Canvas.SetTop(earR, 4);
            canvas.Children.Add(earR);

            var head = new Ellipse { Width = 48, Height = 42, Fill = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)) };
            Canvas.SetLeft(head, 6);
            Canvas.SetTop(head, 12);
            canvas.Children.Add(head);

            var muzzle = new Ellipse { Width = 26, Height = 20, Fill = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)) };
            Canvas.SetLeft(muzzle, 17);
            Canvas.SetTop(muzzle, 24);
            canvas.Children.Add(muzzle);

            var nose = new Ellipse { Width = 8, Height = 6, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(nose, 26);
            Canvas.SetTop(nose, 27);
            canvas.Children.Add(nose);

            return canvas;
        }

        private static FrameworkElement BuildCatMascot()
        {
            var canvas = new Canvas { Width = 56, Height = 52 };

            var cat = new Path
            {
                Fill = new SolidColorBrush(Color.FromRgb(0xCB, 0xA6, 0xF7)),
                Data = Geometry.Parse("M 6,18 L 12,2 L 24,14 L 32,14 L 44,2 L 50,18 Q 56,36 28,46 Q 0,36 6,18 Z")
            };
            canvas.Children.Add(cat);

            var leftEye = new Ellipse { Width = 6, Height = 7, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            var rightEye = new Ellipse { Width = 6, Height = 7, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(leftEye, 16);
            Canvas.SetTop(leftEye, 20);
            Canvas.SetLeft(rightEye, 34);
            Canvas.SetTop(rightEye, 20);
            canvas.Children.Add(leftEye);
            canvas.Children.Add(rightEye);

            var cheekL = new Ellipse { Width = 7, Height = 4, Fill = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)), Opacity = 0.6 };
            Canvas.SetLeft(cheekL, 11);
            Canvas.SetTop(cheekL, 27);
            canvas.Children.Add(cheekL);

            return canvas;
        }

        private static FrameworkElement BuildBirdMascot()
        {
            var canvas = new Canvas { Width = 56, Height = 48 };

            var body = new Ellipse { Width = 38, Height = 34, Fill = new SolidColorBrush(Color.FromRgb(0x74, 0xC7, 0xEC)) };
            Canvas.SetLeft(body, 6);
            Canvas.SetTop(body, 8);
            canvas.Children.Add(body);

            var beak = new Polygon
            {
                Points = new PointCollection { new Point(36, 20), new Point(52, 25), new Point(36, 30) },
                Fill = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF))
            };
            canvas.Children.Add(beak);

            var eye = new Ellipse { Width = 6, Height = 6, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(eye, 26);
            Canvas.SetTop(eye, 16);
            canvas.Children.Add(eye);

            return canvas;
        }

        private static FrameworkElement BuildSprocketMascot()
        {
            var canvas = new Canvas { Width = 54, Height = 56 };

            var body = new Ellipse { Width = 38, Height = 46, Fill = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)), Stroke = new SolidColorBrush(Color.FromRgb(0xE8, 0xA3, 0x3C)), StrokeThickness = 1.2 };
            Canvas.SetLeft(body, 8);
            Canvas.SetTop(body, 6);
            canvas.Children.Add(body);

            var beak = new Polygon
            {
                Points = new PointCollection { new Point(36, 22), new Point(52, 25), new Point(36, 30) },
                Fill = new SolidColorBrush(Color.FromRgb(0xFF, 0x9E, 0x3D))
            };
            canvas.Children.Add(beak);

            var eye = new Ellipse { Width = 6, Height = 7, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(eye, 26);
            Canvas.SetTop(eye, 16);
            canvas.Children.Add(eye);

            return canvas;
        }

        public static FrameworkElement BuildWhammyElement(double scale = 1.0)
        {
            var (element, _) = BuildWhammyMascot();
            return new Viewbox
            {
                Width = 74 * scale,
                Height = 64 * scale,
                Child = element,
                Stretch = Stretch.Uniform
            };
        }

        public static (FrameworkElement element, RotateTransform malletTransform) BuildWhammyMascot()
        {
            var canvas = new Canvas { Width = 74, Height = 64 };

            // 1. Little animated cape
            var cape = new Path
            {
                Fill = new SolidColorBrush(Color.FromRgb(0x18, 0x18, 0x25)),
                Stroke = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                StrokeThickness = 1.2,
                Data = Geometry.Parse("M 20,24 Q 8,36 12,54 Q 28,48 30,34 Z")
            };
            canvas.Children.Add(cape);

            // 2. Red Whammy Head & Body
            var body = new Ellipse
            {
                Width = 42,
                Height = 44,
                Fill = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                Stroke = new SolidColorBrush(Color.FromRgb(0xD2, 0x0F, 0x39)),
                StrokeThickness = 1.5
            };
            Canvas.SetLeft(body, 16);
            Canvas.SetTop(body, 14);
            canvas.Children.Add(body);

            // Pointy Ears / Horns
            var hornL = new Polygon
            {
                Points = new PointCollection { new Point(20, 18), new Point(14, 2), new Point(28, 14) },
                Fill = new SolidColorBrush(Color.FromRgb(0xD2, 0x0F, 0x39))
            };
            var hornR = new Polygon
            {
                Points = new PointCollection { new Point(44, 14), new Point(56, 2), new Point(52, 18) },
                Fill = new SolidColorBrush(Color.FromRgb(0xD2, 0x0F, 0x39))
            };
            canvas.Children.Add(hornL);
            canvas.Children.Add(hornR);

            // Cream Belly
            var belly = new Ellipse
            {
                Width = 24,
                Height = 22,
                Fill = new SolidColorBrush(Color.FromRgb(0xF5, 0xE0, 0xDC))
            };
            Canvas.SetLeft(belly, 25);
            Canvas.SetTop(belly, 30);
            canvas.Children.Add(belly);

            // Big expressive eyes
            var eyeL = new Ellipse { Width = 9, Height = 10, Fill = Brushes.White };
            var pupilL = new Ellipse { Width = 5, Height = 5, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(eyeL, 24);
            Canvas.SetTop(eyeL, 20);
            Canvas.SetLeft(pupilL, 25);
            Canvas.SetTop(pupilL, 23);
            canvas.Children.Add(eyeL);
            canvas.Children.Add(pupilL);

            var eyeR = new Ellipse { Width = 9, Height = 10, Fill = Brushes.White };
            var pupilR = new Ellipse { Width = 5, Height = 5, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(eyeR, 39);
            Canvas.SetTop(eyeR, 20);
            Canvas.SetLeft(pupilR, 40);
            Canvas.SetTop(pupilR, 23);
            canvas.Children.Add(eyeR);
            canvas.Children.Add(pupilR);

            // Mischievous smirk/grin
            var grin = new Path
            {
                Stroke = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                StrokeThickness = 2,
                Data = Geometry.Parse("M 26,34 Q 37,42 46,33")
            };
            canvas.Children.Add(grin);

            // 3. GIANT CARTOON MALLET / SLEDGEHAMMER
            var malletCanvas = new Canvas { Width = 40, Height = 46 };
            var malletRot = new RotateTransform(0, 8, 38);
            malletCanvas.RenderTransform = malletRot;

            // Wooden handle
            var handle = new Rectangle
            {
                Width = 5,
                Height = 32,
                Fill = new SolidColorBrush(Color.FromRgb(0xDF, 0x8E, 0x1D)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x8C, 0x50, 0x07)),
                StrokeThickness = 1,
                RadiusX = 2,
                RadiusY = 2
            };
            Canvas.SetLeft(handle, 6);
            Canvas.SetTop(handle, 10);
            malletCanvas.Children.Add(handle);

            // Giant Mallet Head
            var malletHead = new Border
            {
                Width = 24,
                Height = 14,
                Background = new SolidColorBrush(Color.FromRgb(0x58, 0x5B, 0x70)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0xBA, 0xC2, 0xDE)),
                BorderThickness = new Thickness(1.5),
                CornerRadius = new CornerRadius(3)
            };
            Canvas.SetLeft(malletHead, -3);
            Canvas.SetTop(malletHead, 2);
            malletCanvas.Children.Add(malletHead);

            Canvas.SetLeft(malletCanvas, 42);
            Canvas.SetTop(malletCanvas, 8);
            canvas.Children.Add(malletCanvas);

            return (canvas, malletRot);
        }

        private static void SpawnWhammySparks(Canvas canvas, Point center)
        {
            Color[] sparkColors = { Color.FromRgb(0xF3, 0x8B, 0xA8), Color.FromRgb(0xFA, 0xB3, 0x87), Color.FromRgb(0xF9, 0xE2, 0xAF), Colors.White };

            for (int i = 0; i < 26; i++)
            {
                double angle = (i / 26.0) * 2 * Math.PI + (Rng.NextDouble() * 0.4 - 0.2);
                double speed = Rng.Next(40, 140);
                double destX = center.X + Math.Cos(angle) * speed;
                double destY = center.Y + Math.Sin(angle) * speed;

                FrameworkElement p;
                if (i % 5 == 0)
                {
                    p = new TextBlock { Text = (i % 2 == 0) ? "🚫" : "💥", FontSize = 14 };
                }
                else
                {
                    p = new Border
                    {
                        Width = Rng.Next(5, 10),
                        Height = Rng.Next(3, 7),
                        Background = new SolidColorBrush(sparkColors[Rng.Next(sparkColors.Length)]),
                        CornerRadius = new CornerRadius(2)
                    };
                }

                var trans = new TranslateTransform();
                p.RenderTransform = trans;
                Canvas.SetLeft(p, center.X);
                Canvas.SetTop(p, center.Y);
                canvas.Children.Add(p);

                var animX = new DoubleAnimation(0, destX - center.X, TimeSpan.FromMilliseconds(450)) { EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut } };
                var animY = new DoubleAnimation(0, destY - center.Y + 20, TimeSpan.FromMilliseconds(500)) { EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut } };
                var fade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(400)) { BeginTime = TimeSpan.FromMilliseconds(120) };

                trans.BeginAnimation(TranslateTransform.XProperty, animX);
                trans.BeginAnimation(TranslateTransform.YProperty, animY);
                p.BeginAnimation(UIElement.OpacityProperty, fade);
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        // 5. MILESTONE CLOSED PARTY (Full-Screen Mega Celebration)
        // ══════════════════════════════════════════════════════════════════════
        private static readonly string[] PartyPhrases =
        {
            "🎉 WE DID IT!", "🏆 LEGENDARY!", "🥳 PARTY TIME!", "🎊 ABSOLUTE UNIT!",
            "✨ HALL OF FAME!", "💎 PERFECTION!", "🔥 UNSTOPPABLE!", "👑 CROWNED!"
        };

        public static void PlayMilestoneClosedParty(FrameworkElement? targetElement, string milestoneTitle)
        {
            if (Application.Current?.MainWindow is not Window mainWin) return;

            mainWin.Dispatcher.Invoke(() =>
            {
                try
                {
                    var session = CreateOverlay(mainWin, clipToBounds: true);
                    if (session == null) return;
                    var canvas = session.Canvas;
                    double winW = mainWin.ActualWidth;
                    double winH = mainWin.ActualHeight;

                    // ── 0. FULL-SCREEN DARK OVERLAY WITH FADE-IN ──
                    var overlay = new Border
                    {
                        Width = winW,
                        Height = winH,
                        Background = new SolidColorBrush(Color.FromArgb(0xCC, 0x11, 0x11, 0x1B)),
                        Opacity = 0
                    };
                    canvas.Children.Add(overlay);
                    var overlayFade = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(400));
                    overlay.BeginAnimation(UIElement.OpacityProperty, overlayFade);

                    // ── 1. DISCO / PARTY LIGHTS (rotating color washes) ──
                    for (int li = 0; li < 6; li++)
                    {
                        var lightColor = ConfettiColors[li % ConfettiColors.Length];
                        var spotlight = new Ellipse
                        {
                            Width = 350 + Rng.Next(200),
                            Height = 350 + Rng.Next(200),
                            Fill = new RadialGradientBrush(
                                Color.FromArgb(0x55, lightColor.R, lightColor.G, lightColor.B),
                                Colors.Transparent),
                            Opacity = 0
                        };
                        Canvas.SetLeft(spotlight, Rng.Next(0, (int)winW - 200));
                        Canvas.SetTop(spotlight, Rng.Next(0, (int)winH - 200));
                        canvas.Children.Add(spotlight);

                        var lightPulse = new DoubleAnimation(0, 0.7, TimeSpan.FromMilliseconds(600 + Rng.Next(400)))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(7000)),
                            BeginTime = TimeSpan.FromMilliseconds(200 + li * 180)
                        };
                        spotlight.BeginAnimation(UIElement.OpacityProperty, lightPulse);

                        var lightDrift = new DoubleAnimation(0, Rng.Next(-80, 80), TimeSpan.FromMilliseconds(3000 + Rng.Next(2000)))
                        {
                            AutoReverse = true,
                            RepeatBehavior = RepeatBehavior.Forever
                        };
                        var driftTrans = new TranslateTransform();
                        spotlight.RenderTransform = driftTrans;
                        driftTrans.BeginAnimation(TranslateTransform.XProperty, lightDrift);
                    }

                    // ── 2. GIANT GOLDEN TROPHY BANNER (center) ──
                    var bannerBorder = new Border
                    {
                        Background = new LinearGradientBrush(
                            Color.FromRgb(0xF9, 0xE2, 0xAF),
                            Color.FromRgb(0xDF, 0x8E, 0x1D),
                            new Point(0, 0), new Point(1, 1)),
                        BorderBrush = new SolidColorBrush(Color.FromRgb(0xFF, 0xD7, 0x00)),
                        BorderThickness = new Thickness(3),
                        CornerRadius = new CornerRadius(16),
                        Padding = new Thickness(30, 16, 30, 16),
                        Opacity = 0,
                        RenderTransformOrigin = new Point(0.5, 0.5),
                        Effect = new DropShadowEffect
                        {
                            Color = Color.FromRgb(0xFF, 0xD7, 0x00),
                            BlurRadius = 40,
                            ShadowDepth = 0,
                            Opacity = 0.9
                        }
                    };
                    var bannerScale = new ScaleTransform(0.1, 0.1);
                    bannerBorder.RenderTransform = bannerScale;
                    var bannerStack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
                    bannerStack.Children.Add(new TextBlock
                    {
                        Text = "🏆",
                        FontSize = 42,
                        HorizontalAlignment = HorizontalAlignment.Center
                    });
                    bannerStack.Children.Add(new TextBlock
                    {
                        Text = "MILESTONE CLOSED!",
                        FontSize = 22,
                        FontWeight = FontWeights.Black,
                        Foreground = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                        HorizontalAlignment = HorizontalAlignment.Center
                    });
                    bannerStack.Children.Add(new TextBlock
                    {
                        Text = milestoneTitle.Length > 40 ? milestoneTitle.Substring(0, 37) + "…" : milestoneTitle,
                        FontSize = 16,
                        FontWeight = FontWeights.Bold,
                        Foreground = new SolidColorBrush(Color.FromArgb(0xCC, 0x11, 0x11, 0x1B)),
                        HorizontalAlignment = HorizontalAlignment.Center,
                        Margin = new Thickness(0, 4, 0, 0)
                    });
                    bannerStack.Children.Add(new TextBlock
                    {
                        Text = PartyPhrases[Rng.Next(PartyPhrases.Length)],
                        FontSize = 14,
                        FontWeight = FontWeights.SemiBold,
                        Foreground = new SolidColorBrush(Color.FromArgb(0xAA, 0x11, 0x11, 0x1B)),
                        HorizontalAlignment = HorizontalAlignment.Center,
                        Margin = new Thickness(0, 6, 0, 0)
                    });
                    bannerBorder.Child = bannerStack;

                    bannerBorder.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                    double bw = bannerBorder.DesiredSize.Width;
                    Canvas.SetLeft(bannerBorder, (winW - bw) / 2);
                    Canvas.SetTop(bannerBorder, winH * 0.18);
                    canvas.Children.Add(bannerBorder);

                    // Banner slam-in
                    var bannerOpacity = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200)) { BeginTime = TimeSpan.FromMilliseconds(300) };
                    var bannerPop = new DoubleAnimation(0.1, 1.1, TimeSpan.FromMilliseconds(500))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(300),
                        EasingFunction = new ElasticEase { Oscillations = 2, Springiness = 4 }
                    };
                    bannerBorder.BeginAnimation(UIElement.OpacityProperty, bannerOpacity);
                    bannerScale.BeginAnimation(ScaleTransform.ScaleXProperty, bannerPop);
                    bannerScale.BeginAnimation(ScaleTransform.ScaleYProperty, bannerPop);

                    // ── 3. ALL CRITTERS DANCING ON STAGE ── drawn from the full rotation (original 5 +
                    // Copilot critters, Git #1452), not just hardcoded indices 0-4.
                    double stageY = winH * 0.52;
                    double stageStartX = (winW - 5 * 100) / 2;

                    string[] partyEmojis = { "👑", "🎈", "🎉", "🎺", "⭐", "🥳", "💃", "🕺" };
                    int[] stageIndices = PickParadeMascotIndices(5);

                    for (int i = 0; i < 5; i++)
                    {
                        var (critter, _) = BuildMascot(stageIndices[i]);

                        // Party hat / decoration above
                        var decor = new TextBlock
                        {
                            Text = partyEmojis[i],
                            FontSize = 18,
                            Margin = new Thickness(16, -22, 0, 0)
                        };
                        if (critter is Canvas c) c.Children.Add(decor);

                        double posX = stageStartX + i * 100;
                        double baseScale = 2.0;

                        var group = new TransformGroup();
                        var scaleT = new ScaleTransform(baseScale, baseScale);
                        var translateT = new TranslateTransform();
                        group.Children.Add(scaleT);
                        group.Children.Add(translateT);
                        critter.RenderTransform = group;
                        critter.RenderTransformOrigin = new Point(0.5, 1.0);
                        critter.Opacity = 0;

                        Canvas.SetLeft(critter, posX);
                        Canvas.SetTop(critter, stageY);
                        canvas.Children.Add(critter);

                        int delay = 400 + i * 150;

                        // Pop in from below
                        var popIn = new DoubleAnimation(60, 0, TimeSpan.FromMilliseconds(400))
                        {
                            BeginTime = TimeSpan.FromMilliseconds(delay),
                            EasingFunction = new BackEase { Amplitude = 0.8, EasingMode = EasingMode.EaseOut }
                        };
                        translateT.BeginAnimation(TranslateTransform.YProperty, popIn);
                        var fadeIn = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200)) { BeginTime = TimeSpan.FromMilliseconds(delay) };
                        critter.BeginAnimation(UIElement.OpacityProperty, fadeIn);

                        // DANCING! — continuous bounce / hop
                        var danceY = new DoubleAnimation(0, -20 - Rng.Next(15), TimeSpan.FromMilliseconds(250 + Rng.Next(150)))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(6500)),
                            BeginTime = TimeSpan.FromMilliseconds(delay + 400),
                            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                        };
                        translateT.BeginAnimation(TranslateTransform.YProperty, danceY);

                        // Side-to-side sway
                        var swayX = new DoubleAnimation(-12, 12, TimeSpan.FromMilliseconds(400 + Rng.Next(200)))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(6500)),
                            BeginTime = TimeSpan.FromMilliseconds(delay + 500)
                        };
                        translateT.BeginAnimation(TranslateTransform.XProperty, swayX);

                        // Squash-and-stretch dance pulse
                        var squashX = new DoubleAnimation(baseScale, baseScale * 1.15, TimeSpan.FromMilliseconds(200 + Rng.Next(100)))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(6500)),
                            BeginTime = TimeSpan.FromMilliseconds(delay + 400)
                        };
                        var squashY = new DoubleAnimation(baseScale, baseScale * 0.85, TimeSpan.FromMilliseconds(200 + Rng.Next(100)))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(6500)),
                            BeginTime = TimeSpan.FromMilliseconds(delay + 400)
                        };
                        scaleT.BeginAnimation(ScaleTransform.ScaleXProperty, squashX);
                        scaleT.BeginAnimation(ScaleTransform.ScaleYProperty, squashY);
                    }

                    // ── 4. CONFETTI CANNON WAVES (multiple timed bursts) ──
                    for (int wave = 0; wave < 8; wave++)
                    {
                        int waveDelay = 500 + wave * 450;
                        var confettiTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(waveDelay) };
                        confettiTimer.Tick += (_, _) =>
                        {
                            confettiTimer.Stop();
                            double cx = Rng.Next(80, (int)(winW - 80));
                            double cy = Rng.Next(60, (int)(winH * 0.5));
                            SpawnConfettiBurst(canvas, new Point(cx, cy), 40, isEpic: true);
                        };
                        confettiTimer.Start();
                    }

                    // ── 5. RISING BALLOONS ──
                    for (int b = 0; b < 14; b++)
                    {
                        int balloonDelay = 300 + b * 200;
                        var balloonTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(balloonDelay) };
                        balloonTimer.Tick += (_, _) =>
                        {
                            balloonTimer.Stop();
                            SpawnBalloon(canvas, winW, winH);
                        };
                        balloonTimer.Start();
                    }

                    // ── 6. FIREWORK STARBURSTS ──
                    for (int f = 0; f < 5; f++)
                    {
                        int fwDelay = 800 + f * 700;
                        var fwTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(fwDelay) };
                        fwTimer.Tick += (_, _) =>
                        {
                            fwTimer.Stop();
                            SpawnFireworkBurst(canvas, new Point(
                                Rng.Next(100, (int)(winW - 100)),
                                Rng.Next(60, (int)(winH * 0.45))));
                        };
                        fwTimer.Start();
                    }

                    // ── 7. STREAMERS (falling ribbons from above) ──
                    for (int s = 0; s < 20; s++)
                    {
                        int sDelay = 400 + s * 130;
                        var sTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(sDelay) };
                        sTimer.Tick += (_, _) =>
                        {
                            sTimer.Stop();
                            SpawnStreamer(canvas, winW, winH);
                        };
                        sTimer.Start();
                    }

                    // ── 8. FADE OUT & CLEANUP ──
                    var fadeOutTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(6200) };
                    fadeOutTimer.Tick += (_, _) =>
                    {
                        fadeOutTimer.Stop();
                        var fadeAll = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(800));
                        fadeAll.Completed += (__, ___) => session.Close();
                        canvas.BeginAnimation(UIElement.OpacityProperty, fadeAll);
                    };
                    fadeOutTimer.Start();
                }
                catch { }
            });
        }

        private static void SpawnBalloon(Canvas canvas, double winW, double winH)
        {
            string[] balloonEmoji = { "🎈", "🎈", "🎈", "🎈", "🟡", "🟣", "🔵", "🟢", "🔴" };
            var balloon = new TextBlock
            {
                Text = balloonEmoji[Rng.Next(balloonEmoji.Length)],
                FontSize = 26 + Rng.Next(14),
                Opacity = 0.85
            };
            double startX = Rng.Next(30, (int)(winW - 50));
            Canvas.SetLeft(balloon, startX);
            Canvas.SetTop(balloon, winH + 20);
            canvas.Children.Add(balloon);

            var riseT = new TranslateTransform();
            balloon.RenderTransform = riseT;

            var rise = new DoubleAnimation(0, -(winH + 80), TimeSpan.FromMilliseconds(3000 + Rng.Next(2000)))
            {
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseIn }
            };
            var drift = new DoubleAnimation(0, Rng.Next(-60, 60), TimeSpan.FromMilliseconds(2500 + Rng.Next(1500)))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };
            riseT.BeginAnimation(TranslateTransform.YProperty, rise);
            riseT.BeginAnimation(TranslateTransform.XProperty, drift);

            var fade = new DoubleAnimation(0.85, 0, TimeSpan.FromMilliseconds(600))
            {
                BeginTime = TimeSpan.FromMilliseconds(2800 + Rng.Next(1500))
            };
            balloon.BeginAnimation(UIElement.OpacityProperty, fade);
        }

        private static void SpawnFireworkBurst(Canvas canvas, Point center)
        {
            int rays = 16 + Rng.Next(8);
            var sparkColor = ConfettiColors[Rng.Next(ConfettiColors.Length)];

            for (int r = 0; r < rays; r++)
            {
                double angle = (r / (double)rays) * 2 * Math.PI;
                double speed = 60 + Rng.Next(100);
                double destX = center.X + Math.Cos(angle) * speed;
                double destY = center.Y + Math.Sin(angle) * speed;

                var sparkle = new Ellipse
                {
                    Width = 4 + Rng.Next(4),
                    Height = 4 + Rng.Next(4),
                    Fill = new SolidColorBrush(sparkColor)
                };
                Canvas.SetLeft(sparkle, center.X);
                Canvas.SetTop(sparkle, center.Y);
                canvas.Children.Add(sparkle);

                var trans = new TranslateTransform();
                sparkle.RenderTransform = trans;

                var moveX = new DoubleAnimation(0, destX - center.X, TimeSpan.FromMilliseconds(500 + Rng.Next(300)))
                {
                    EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut }
                };
                var moveY = new DoubleAnimation(0, destY - center.Y + 30, TimeSpan.FromMilliseconds(600 + Rng.Next(300)))
                {
                    EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut }
                };
                var fade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(400))
                {
                    BeginTime = TimeSpan.FromMilliseconds(300 + Rng.Next(200))
                };
                trans.BeginAnimation(TranslateTransform.XProperty, moveX);
                trans.BeginAnimation(TranslateTransform.YProperty, moveY);
                sparkle.BeginAnimation(UIElement.OpacityProperty, fade);
            }

            // Central flash
            var flash = new Ellipse
            {
                Width = 30,
                Height = 30,
                Fill = new RadialGradientBrush(Colors.White, Colors.Transparent),
                RenderTransformOrigin = new Point(0.5, 0.5)
            };
            Canvas.SetLeft(flash, center.X - 15);
            Canvas.SetTop(flash, center.Y - 15);
            canvas.Children.Add(flash);

            var flashScale = new ScaleTransform(0.3, 0.3);
            flash.RenderTransform = flashScale;
            var flashPop = new DoubleAnimation(0.3, 3.0, TimeSpan.FromMilliseconds(300));
            var flashFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(300));
            flashScale.BeginAnimation(ScaleTransform.ScaleXProperty, flashPop);
            flashScale.BeginAnimation(ScaleTransform.ScaleYProperty, flashPop);
            flash.BeginAnimation(UIElement.OpacityProperty, flashFade);
        }

        private static void SpawnStreamer(Canvas canvas, double winW, double winH)
        {
            var color = ConfettiColors[Rng.Next(ConfettiColors.Length)];
            double streamerWidth = 4 + Rng.Next(5);
            double streamerHeight = 30 + Rng.Next(40);

            var streamer = new Border
            {
                Width = streamerWidth,
                Height = streamerHeight,
                Background = new SolidColorBrush(color),
                CornerRadius = new CornerRadius(streamerWidth / 2),
                Opacity = 0.8
            };
            double startX = Rng.Next(20, (int)(winW - 20));
            Canvas.SetLeft(streamer, startX);
            Canvas.SetTop(streamer, -streamerHeight);
            canvas.Children.Add(streamer);

            var trans = new TransformGroup();
            var translate = new TranslateTransform();
            var rotate = new RotateTransform(Rng.Next(-30, 30));
            trans.Children.Add(rotate);
            trans.Children.Add(translate);
            streamer.RenderTransform = trans;
            streamer.RenderTransformOrigin = new Point(0.5, 0.5);

            var fall = new DoubleAnimation(0, winH + streamerHeight + 20, TimeSpan.FromMilliseconds(2500 + Rng.Next(2000)))
            {
                EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
            };
            var sway = new DoubleAnimation(0, Rng.Next(-50, 50), TimeSpan.FromMilliseconds(800 + Rng.Next(600)))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };
            var spin = new DoubleAnimation(Rng.Next(-30, 30), Rng.Next(-180, 180), TimeSpan.FromMilliseconds(2000 + Rng.Next(1500)));
            translate.BeginAnimation(TranslateTransform.YProperty, fall);
            translate.BeginAnimation(TranslateTransform.XProperty, sway);
            rotate.BeginAnimation(RotateTransform.AngleProperty, spin);

            var fade = new DoubleAnimation(0.8, 0, TimeSpan.FromMilliseconds(500))
            {
                BeginTime = TimeSpan.FromMilliseconds(2200 + Rng.Next(1500))
            };
            streamer.BeginAnimation(UIElement.OpacityProperty, fade);
        }
    }
}

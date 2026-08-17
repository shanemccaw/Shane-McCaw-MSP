using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;

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

            public void Close()
            {
                try
                {
                    OverlayWindow.Close();
                }
                catch { }
            }
        }

        /// <summary>
        /// Creates a borderless, transparent, topmost overlay Window sized and positioned precisely
        /// over the main window. Because this is a separate top-level Win32 window, it renders completely
        /// ABOVE WebView2 child HWNDs (solving WPF Airspace) without stealing focus or intercepting clicks.
        /// </summary>
        private static OverlaySession? CreateOverlay(Window mainWin, bool clipToBounds = false)
        {
            if (!mainWin.IsLoaded || mainWin.ActualWidth <= 0 || mainWin.ActualHeight <= 0) return null;

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
                return new OverlaySession { OverlayWindow = overlayWin, Canvas = canvas };
            }
            catch
            {
                return null;
            }
        }
        private static readonly Random Rng = new();

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

                    Point targetPos = new Point(mainWin.ActualWidth * 0.35, mainWin.ActualHeight * 0.45);
                    if (targetElement != null && targetElement.IsLoaded)
                    {
                        try
                        {
                            var screenPoint = targetElement.PointToScreen(new Point(targetElement.ActualWidth / 2, targetElement.ActualHeight / 2));
                            targetPos = mainWin.PointFromScreen(screenPoint);
                        }
                        catch { }
                    }

                    targetPos.X = Math.Clamp(targetPos.X, 120, Math.Max(140, mainWin.ActualWidth - 200));
                    targetPos.Y = Math.Clamp(targetPos.Y, 90, Math.Max(110, mainWin.ActualHeight - 140));

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

                    // Mascot Selection
                    int charIndex = Rng.Next(5);
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
                    var charTransform = new TransformGroup();
                    var charTranslate = new TranslateTransform();
                    var charHopTranslate = new TranslateTransform();
                    // Face LEFT (starts on far right, runs left across tabs to the left sidebar)
                    var charScaleTransform = new ScaleTransform(-critterScale, critterScale);
                    charTransform.Children.Add(charScaleTransform);
                    charTransform.Children.Add(charTranslate);
                    charTransform.Children.Add(charHopTranslate);
                    character.RenderTransform = charTransform;
                    character.RenderTransformOrigin = new Point(0.5, 0.5);

                    // Start at the far RIGHT of the window (over the Build Queue panel)
                    double winW = mainWin.ActualWidth;
                    double startX = winW + 40;
                    double startY = targetPos.Y - (isEpic ? 45 : 25);
                    Canvas.SetLeft(character, startX);
                    Canvas.SetTop(character, startY);
                    canvas.Children.Add(character);

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

                    // Step 1: Sprint across the ENTIRE screen (from right Build Queue panel across main tabs to left issue)
                    double targetArrivalX = targetPos.X + (isEpic ? 35 : 25);
                    double sprintDistance = targetArrivalX - startX;
                    int sprintDuration = isEpic ? 800 : 700;

                    var sprintX = new DoubleAnimation(0, sprintDistance, TimeSpan.FromMilliseconds(sprintDuration))
                    {
                        EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                    };
                    charTranslate.BeginAnimation(TranslateTransform.XProperty, sprintX);

                    // Gallop / Bouncing hop while sprinting across the screen
                    var hop = new DoubleAnimation(0, -18, TimeSpan.FromMilliseconds(110))
                    {
                        AutoReverse = true,
                        RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(sprintDuration)),
                        EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                    };
                    charHopTranslate.BeginAnimation(TranslateTransform.YProperty, hop);

                    // Step 2: Speech bubble pop right when arriving at the issue
                    int bubblePopDelay = Math.Max(100, sprintDuration - 140);
                    var popOpacity = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(150)) { BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay) };
                    var popScale = new DoubleAnimation(0.2, isEpic ? 1.35 : 1.15, TimeSpan.FromMilliseconds(200))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay),
                        EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 4 }
                    };
                    bubble.BeginAnimation(UIElement.OpacityProperty, popOpacity);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleXProperty, popScale);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleYProperty, popScale);

                    // Step 3: Crunch & Burst on arrival
                    int crunchDelay = sprintDuration;
                    var crunchTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(crunchDelay) };
                    crunchTimer.Tick += (_, _) =>
                    {
                        crunchTimer.Stop();

                        var shrink = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(160))
                        {
                            EasingFunction = new BackEase { Amplitude = 2.5, EasingMode = EasingMode.EaseIn }
                        };
                        cardScale.BeginAnimation(ScaleTransform.ScaleXProperty, shrink);
                        cardScale.BeginAnimation(ScaleTransform.ScaleYProperty, shrink);

                        var gulp = new DoubleAnimation(critterScale, critterScale * 1.4, TimeSpan.FromMilliseconds(140))
                        {
                            AutoReverse = true,
                            EasingFunction = new BounceEase { Bounces = 1, Bounciness = 2 }
                        };
                        charScaleTransform.BeginAnimation(ScaleTransform.ScaleYProperty, gulp);

                        SpawnConfettiBurst(canvas, targetPos, isEpic ? 45 : 22, isEpic);
                    };
                    crunchTimer.Start();

                    // Step 4: Victory exit (continue dashing off the screen to the Left)
                    int exitDelay = sprintDuration + 550;
                    var exitTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(exitDelay) };
                    exitTimer.Tick += (_, _) =>
                    {
                        exitTimer.Stop();

                        double exitDistance = sprintDistance - (targetPos.X + 250);
                        var exitX = new DoubleAnimation(sprintDistance, exitDistance, TimeSpan.FromMilliseconds(450))
                        {
                            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
                        };
                        var exitFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(380))
                        {
                            BeginTime = TimeSpan.FromMilliseconds(100)
                        };
                        charTranslate.BeginAnimation(TranslateTransform.XProperty, exitX);
                        character.BeginAnimation(UIElement.OpacityProperty, exitFade);
                        bubble.BeginAnimation(UIElement.OpacityProperty, exitFade);
                    };
                    exitTimer.Start();

                    // Step 5: Clean up canvas
                    int totalDuration = sprintDuration + 1150;
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

                    // 2. Spawn All 5 Mascots in a Marching Parade Line
                    double paradeY = winH * 0.55;
                    var paradeMascots = new List<(FrameworkElement Critter, TranslateTransform Trans, ScaleTransform Scale)>();

                    for (int i = 0; i < 5; i++)
                    {
                        var (critter, _) = BuildMascot(i);

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

                        // March across animation (Right to Left)
                        var march = new DoubleAnimation(0, -(winW + 300 + (i * 90)), TimeSpan.FromMilliseconds(3200))
                        {
                            BeginTime = TimeSpan.FromMilliseconds(i * 120)
                        };
                        transX.BeginAnimation(TranslateTransform.XProperty, march);

                        // Bouncing hop while marching
                        var hop = new DoubleAnimation(1.6, 2.0, TimeSpan.FromMilliseconds(180))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(3000)),
                            BeginTime = TimeSpan.FromMilliseconds(i * 120),
                            EasingFunction = new BounceEase { Bounces = 1, Bounciness = 2 }
                        };
                        scale.BeginAnimation(ScaleTransform.ScaleYProperty, hop);
                    }

                    // 3. Huge Party Confetti & Fireworks Storm
                    for (int wave = 0; wave < 3; wave++)
                    {
                        var waveTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(wave * 400 + 100) };
                        waveTimer.Tick += (_, _) =>
                        {
                            waveTimer.Stop();
                            Point centerPoint = new Point(winW * (0.25 + (Rng.NextDouble() * 0.5)), winH * 0.35);
                            SpawnConfettiBurst(canvas, centerPoint, 35, isEpic: true);
                        };
                        waveTimer.Start();
                    }

                    // 4. Milestone Banner Crunch by Lead Mascot (around 1200ms)
                    var bannerChompTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1300) };
                    bannerChompTimer.Tick += (_, _) =>
                    {
                        bannerChompTimer.Stop();

                        var bannerShrink = new DoubleAnimation(1.15, 0, TimeSpan.FromMilliseconds(250))
                        {
                            EasingFunction = new BackEase { Amplitude = 2, EasingMode = EasingMode.EaseIn }
                        };
                        bannerScale.BeginAnimation(ScaleTransform.ScaleXProperty, bannerShrink);
                        bannerScale.BeginAnimation(ScaleTransform.ScaleYProperty, bannerShrink);

                        SpawnConfettiBurst(canvas, new Point(winW / 2, winH * 0.32), 50, isEpic: true);
                    };
                    bannerChompTimer.Start();

                    // 5. Cleanup
                    var cleanupTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(3800) };
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
        public static void PlayWhammy(FrameworkElement? targetElement, string issueTitle, int? blockerNumber = null)
        {
            if (Application.Current?.MainWindow is not Window mainWin) return;

            mainWin.Dispatcher.Invoke(() =>
            {
                try
                {
                    var session = CreateOverlay(mainWin, clipToBounds: false);
                    if (session == null) return;
                    var canvas = session.Canvas;

                    Point targetPos = new Point(mainWin.ActualWidth * 0.35, mainWin.ActualHeight * 0.45);
                    if (targetElement != null && targetElement.IsLoaded)
                    {
                        try
                        {
                            var screenPoint = targetElement.PointToScreen(new Point(targetElement.ActualWidth / 2, targetElement.ActualHeight / 2));
                            targetPos = mainWin.PointFromScreen(screenPoint);
                        }
                        catch { }
                    }

                    targetPos.X = Math.Clamp(targetPos.X, 140, Math.Max(160, mainWin.ActualWidth - 220));
                    targetPos.Y = Math.Clamp(targetPos.Y, 90, Math.Max(110, mainWin.ActualHeight - 140));

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

                    // Whammy Mascot with articulated sledgehammer
                    var (whammy, malletTransform) = BuildWhammyMascot();

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
                    int chargeDuration = 800;

                    var chargeX = new DoubleAnimation(0, chargeDistance, TimeSpan.FromMilliseconds(chargeDuration))
                    {
                        EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                    };
                    charTranslate.BeginAnimation(TranslateTransform.XProperty, chargeX);

                    // Heavy stomping bounce while charging across the screen
                    var stomp = new DoubleAnimation(0, -16, TimeSpan.FromMilliseconds(120))
                    {
                        AutoReverse = true,
                        RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(chargeDuration)),
                        EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                    };
                    charHopTranslate.BeginAnimation(TranslateTransform.YProperty, stomp);

                    // Step 2: Speech bubble pop right when arriving
                    int bubblePopDelay = Math.Max(100, chargeDuration - 160);
                    var popOpacity = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(120)) { BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay) };
                    var popScale = new DoubleAnimation(0.2, 1.2, TimeSpan.FromMilliseconds(180))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay),
                        EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 4 }
                    };
                    bubble.BeginAnimation(UIElement.OpacityProperty, popOpacity);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleXProperty, popScale);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleYProperty, popScale);

                    // Step 3: Mallet Windup & Heavy SLAM!
                    var malletWindup = new DoubleAnimation(0, 45, TimeSpan.FromMilliseconds(200))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay),
                        EasingFunction = new BackEase { Amplitude = 1.2, EasingMode = EasingMode.EaseIn }
                    };
                    malletTransform.BeginAnimation(RotateTransform.AngleProperty, malletWindup);

                    var slamTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(chargeDuration) };
                    slamTimer.Tick += (_, _) =>
                    {
                        slamTimer.Stop();

                        // Mallet slams down hard (-75 deg)
                        var malletSlam = new DoubleAnimation(45, -75, TimeSpan.FromMilliseconds(120))
                        {
                            EasingFunction = new BounceEase { Bounces = 1, Bounciness = 3 }
                        };
                        malletTransform.BeginAnimation(RotateTransform.AngleProperty, malletSlam);

                        // Card Impact Shock & Jitter
                        var cardJitterX = new DoubleAnimation(0, -8, TimeSpan.FromMilliseconds(40))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(3)
                        };
                        var cardJitterY = new DoubleAnimation(0, 6, TimeSpan.FromMilliseconds(40))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(3)
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

                        var stampDrop = new DoubleAnimation(2.5, 1.0, TimeSpan.FromMilliseconds(160))
                        {
                            EasingFunction = new BounceEase { Bounces = 1, Bounciness = 2 }
                        };
                        stampScale.BeginAnimation(ScaleTransform.ScaleXProperty, stampDrop);
                        stampScale.BeginAnimation(ScaleTransform.ScaleYProperty, stampDrop);

                        // Impact Sparks & Warning icons
                        SpawnWhammySparks(canvas, new Point(targetPos.X + 20, targetPos.Y + 10));
                    };
                    slamTimer.Start();

                    // Step 4: Mischievous Laugh & Dash off to the LEFT
                    int exitDelay = chargeDuration + 600;
                    var exitTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(exitDelay) };
                    exitTimer.Tick += (_, _) =>
                    {
                        exitTimer.Stop();

                        bubbleText.Text = "HEHEHE! 😈";

                        double exitDistance = chargeDistance - (targetPos.X + 250);
                        var exitX = new DoubleAnimation(chargeDistance, exitDistance, TimeSpan.FromMilliseconds(480))
                        {
                            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
                        };
                        var exitFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(420))
                        {
                            BeginTime = TimeSpan.FromMilliseconds(100)
                        };
                        charTranslate.BeginAnimation(TranslateTransform.XProperty, exitX);
                        whammy.BeginAnimation(UIElement.OpacityProperty, exitFade);
                        bubble.BeginAnimation(UIElement.OpacityProperty, exitFade);
                    };
                    exitTimer.Start();

                    // Step 5: Clean up
                    int totalDuration = chargeDuration + 1200;
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
                default: // 🦆 Sprocket Runner
                    return (BuildSprocketMascot(), "CHOMP!");
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

        private static (FrameworkElement element, RotateTransform malletTransform) BuildWhammyMascot()
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

                    // ── 3. ALL CRITTERS DANCING ON STAGE ──
                    double stageY = winH * 0.52;
                    double stageStartX = (winW - 5 * 100) / 2;

                    string[] partyEmojis = { "👑", "🎈", "🎉", "🎺", "⭐", "🥳", "💃", "🕺" };

                    for (int i = 0; i < 5; i++)
                    {
                        var (critter, _) = BuildMascot(i);

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

using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
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
    public static class IssueChompAnimation
    {
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
            if (mainWin.Content is not Grid rootGrid) return;

            mainWin.Dispatcher.Invoke(() =>
            {
                try
                {
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

                    var canvas = new Canvas
                    {
                        Width = mainWin.ActualWidth,
                        Height = mainWin.ActualHeight,
                        IsHitTestVisible = false,
                        ClipToBounds = false
                    };
                    Panel.SetZIndex(canvas, 30000);
                    rootGrid.Children.Add(canvas);

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

                    double critterScale = isEpic ? 2.2 : 1.0;
                    var charTransform = new TransformGroup();
                    var charTranslate = new TranslateTransform();
                    var charScaleTransform = new ScaleTransform(critterScale, critterScale);
                    charTransform.Children.Add(charScaleTransform);
                    charTransform.Children.Add(charTranslate);
                    character.RenderTransform = charTransform;
                    character.RenderTransformOrigin = new Point(0.5, 0.5);

                    double startX = targetPos.X - (isEpic ? 320 : 220);
                    double startY = targetPos.Y - (isEpic ? 50 : 30);
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

                    // Step 1: Lunge in
                    var lungeX = new DoubleAnimation(0, isEpic ? 220 : 160, TimeSpan.FromMilliseconds(isEpic ? 420 : 350))
                    {
                        EasingFunction = new BackEase { Amplitude = 0.6, EasingMode = EasingMode.EaseOut }
                    };
                    charTranslate.BeginAnimation(TranslateTransform.XProperty, lungeX);

                    // Step 2: Speech bubble pop
                    var popOpacity = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(150)) { BeginTime = TimeSpan.FromMilliseconds(200) };
                    var popScale = new DoubleAnimation(0.2, isEpic ? 1.35 : 1.15, TimeSpan.FromMilliseconds(200))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(200),
                        EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 4 }
                    };
                    bubble.BeginAnimation(UIElement.OpacityProperty, popOpacity);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleXProperty, popScale);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleYProperty, popScale);

                    // Step 3: Crunch & Burst
                    int crunchDelay = isEpic ? 420 : 350;
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

                    // Step 4: Victory exit
                    int exitDelay = isEpic ? 900 : 750;
                    var exitTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(exitDelay) };
                    exitTimer.Tick += (_, _) =>
                    {
                        exitTimer.Stop();

                        var exitX = new DoubleAnimation(isEpic ? 220 : 160, isEpic ? 520 : 380, TimeSpan.FromMilliseconds(450))
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
                    int totalDuration = isEpic ? 1550 : 1300;
                    var cleanupTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(totalDuration) };
                    cleanupTimer.Tick += (_, _) =>
                    {
                        cleanupTimer.Stop();
                        rootGrid.Children.Remove(canvas);
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
            if (mainWin.Content is not Grid rootGrid) return;

            mainWin.Dispatcher.Invoke(() =>
            {
                try
                {
                    double winW = mainWin.ActualWidth;
                    double winH = mainWin.ActualHeight;

                    var canvas = new Canvas
                    {
                        Width = winW,
                        Height = winH,
                        IsHitTestVisible = false,
                        ClipToBounds = false
                    };
                    Panel.SetZIndex(canvas, 32000);
                    rootGrid.Children.Add(canvas);

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
                        var scale = new ScaleTransform(1.6, 1.6);
                        transGroup.Children.Add(scale);
                        transGroup.Children.Add(transX);
                        critter.RenderTransform = transGroup;
                        critter.RenderTransformOrigin = new Point(0.5, 0.5);

                        double startPosX = -120 - (i * 90);
                        Canvas.SetLeft(critter, startPosX);
                        Canvas.SetTop(critter, paradeY);
                        canvas.Children.Add(critter);

                        paradeMascots.Add((critter, transX, scale));

                        // March across animation
                        var march = new DoubleAnimation(0, winW + 300 + (i * 90), TimeSpan.FromMilliseconds(3200))
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
                        rootGrid.Children.Remove(canvas);
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
    }
}

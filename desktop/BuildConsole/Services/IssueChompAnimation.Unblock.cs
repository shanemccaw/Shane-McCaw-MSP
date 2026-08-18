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
    /// Celebratory unblock critter animation (Sparky the Keymaster Bunny 🐰🔑✨).
    /// Plays when a blocked issue has its blocker resolved, unlinked, or removed,
    /// unlocking the card with a golden key turn, emerald/gold sparkles, and joyful verbiage.
    /// </summary>
    public static partial class IssueChompAnimation
    {
        private static readonly string[] UnblockPhrases =
        {
            "🔓 UNBLOCKED!",
            "✨ PATH IS CLEAR!",
            "🎉 FREEDOM!",
            "🚀 FULL SPEED AHEAD!",
            "🔑 UNLOCKED!",
            "⚡ BLOCK BUSTED!",
            "🌟 GREEN LIGHT!",
            "💫 YOU'RE FREE!",
            "🎈 OFF TO THE RACES!"
        };

        private static readonly Color[] UnblockSparkColors =
        {
            Color.FromRgb(0xA6, 0xE3, 0xA1), // Mint green
            Color.FromRgb(0xF9, 0xE2, 0xAF), // Golden yellow
            Color.FromRgb(0x89, 0xDC, 0xEB), // Sky cyan
            Color.FromRgb(0xC9, 0xCB, 0xFF), // Lavender
            Color.FromRgb(0xFA, 0xB3, 0x87), // Peach
            Color.FromRgb(0xFF, 0xFF, 0xFF), // Pure white spark
        };

        // ══════════════════════════════════════════════════════════════════════
        // UNBLOCK CELEBRATION (Sparky the Keymaster Bunny)
        // ══════════════════════════════════════════════════════════════════════
        public static void PlayUnblock(FrameworkElement? targetElement, string issueTitle, int? previousBlocker = null)
        {
            if (Application.Current?.MainWindow is not Window mainWin) return;

            mainWin.Dispatcher.Invoke(() =>
            {
                try
                {
                    var session = CreateOverlay(mainWin, clipToBounds: false);
                    if (session == null) return;
                    var canvas = session.Canvas;

                    var (targetPos, seq) = ComputeSpreadTargetPositionWithSeq(mainWin, targetElement, isEpic: false);

                    // Floating target card (initially locked/dim, will unlock to radiant mint green)
                    var cardBorderBrush = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)); // starts locked reddish
                    var cardBgBrush = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E));
                    var issueCard = new Border
                    {
                        Background = cardBgBrush,
                        BorderBrush = cardBorderBrush,
                        BorderThickness = new Thickness(2),
                        CornerRadius = new CornerRadius(8),
                        Padding = new Thickness(14, 8, 14, 8),
                        Effect = new DropShadowEffect
                        {
                            BlurRadius = 18,
                            ShadowDepth = 2,
                            Opacity = 0.75,
                            Color = Color.FromRgb(0xF9, 0xE2, 0xAF)
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
                    var titleRow = new StackPanel { Orientation = Orientation.Horizontal };
                    var lockIcon = new TextBlock
                    {
                        Text = "🔒 ",
                        FontSize = 12.5,
                        Foreground = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8))
                    };
                    titleRow.Children.Add(lockIcon);

                    var cardText = new TextBlock
                    {
                        Text = issueTitle.Length > 32 ? issueTitle.Substring(0, 29) + "…" : issueTitle,
                        Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                        FontSize = 12,
                        FontWeight = FontWeights.Bold
                    };
                    titleRow.Children.Add(cardText);
                    cardStack.Children.Add(titleRow);

                    var subText = new TextBlock
                    {
                        Text = previousBlocker.HasValue ? $"Unlocked from #{previousBlocker.Value}!" : "Blocker resolved!",
                        Foreground = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                        FontSize = 10,
                        FontWeight = FontWeights.SemiBold,
                        Margin = new Thickness(18, 2, 0, 0)
                    };
                    cardStack.Children.Add(subText);
                    issueCard.Child = cardStack;

                    Canvas.SetLeft(issueCard, targetPos.X - 70);
                    Canvas.SetTop(issueCard, targetPos.Y - 20);
                    canvas.Children.Add(issueCard);

                    // Sparky Keymaster Mascot with articulated golden key
                    var (bunny, keyTransform) = BuildUnblockBunnyMascot();

                    bunny.Effect = new DropShadowEffect
                    {
                        Color = Color.FromRgb(0xF9, 0xE2, 0xAF),
                        BlurRadius = 24,
                        ShadowDepth = 0,
                        Opacity = 0.9
                    };

                    double bunnyScale = 1.6;
                    double winW = mainWin.ActualWidth;

                    // Alternate entry from Left or Right based on target quadrant / sequence
                    bool enterFromLeft = (targetPos.X > winW * 0.52) || (seq % 2 == 1);
                    double startX = enterFromLeft ? -50 : (winW + 50);
                    double startY = targetPos.Y - 40;
                    Canvas.SetLeft(bunny, startX);
                    Canvas.SetTop(bunny, startY);
                    canvas.Children.Add(bunny);

                    var charTransform = new TransformGroup();
                    var charTranslate = new TranslateTransform();
                    var charHopTranslate = new TranslateTransform();
                    // Face direction of leap (+ScaleX faces right, -ScaleX faces left)
                    var charScaleTransform = new ScaleTransform(enterFromLeft ? bunnyScale : -bunnyScale, bunnyScale);
                    charTransform.Children.Add(charScaleTransform);
                    charTransform.Children.Add(charTranslate);
                    charTransform.Children.Add(charHopTranslate);
                    bunny.RenderTransform = charTransform;
                    bunny.RenderTransformOrigin = new Point(0.5, 0.5);

                    // Speech bubble with joyful unblock shout
                    var bubble = new Border
                    {
                        Background = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1)),
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
                        Text = UnblockPhrases[Rng.Next(UnblockPhrases.Length)],
                        Foreground = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                        FontSize = 11.5,
                        FontWeight = FontWeights.ExtraBold
                    };
                    bubble.Child = bubbleText;
                    Canvas.SetLeft(bubble, targetPos.X - 50);
                    Canvas.SetTop(bubble, targetPos.Y - 70);
                    canvas.Children.Add(bubble);

                    // Step 1: Joyful bounding leap toward the card
                    double targetArrivalX = enterFromLeft ? (targetPos.X - 35) : (targetPos.X + 35);
                    double sprintDistance = targetArrivalX - startX;
                    int sprintDuration = 1600;

                    var sprintX = new DoubleAnimation(0, sprintDistance, TimeSpan.FromMilliseconds(sprintDuration))
                    {
                        EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                    };
                    charTranslate.BeginAnimation(TranslateTransform.XProperty, sprintX);

                    // High joyful bouncing hops
                    var hop = new DoubleAnimation(0, -26, TimeSpan.FromMilliseconds(180))
                    {
                        AutoReverse = true,
                        RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(sprintDuration)),
                        EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                    };
                    charHopTranslate.BeginAnimation(TranslateTransform.YProperty, hop);

                    // Step 2: Speech bubble pop on arrival
                    int bubblePopDelay = Math.Max(100, sprintDuration - 200);
                    var popOpacity = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200)) { BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay) };
                    var popScale = new DoubleAnimation(0.2, 1.2, TimeSpan.FromMilliseconds(250))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay),
                        EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 4 }
                    };
                    bubble.BeginAnimation(UIElement.OpacityProperty, popOpacity);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleXProperty, popScale);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleYProperty, popScale);

                    // Step 3: Key turn & card unlock explosion! (lingers so it's readable)
                    int unlockDelay = sprintDuration + 300;
                    var unlockTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(unlockDelay) };
                    unlockTimer.Tick += (_, _) =>
                    {
                        unlockTimer.Stop();

                        // Key turn rotation
                        if (keyTransform != null)
                        {
                            var keyTurn = new DoubleAnimation(0, -75, TimeSpan.FromMilliseconds(250))
                            {
                                AutoReverse = true,
                                EasingFunction = new BackEase { Amplitude = 2, EasingMode = EasingMode.EaseOut }
                            };
                            keyTransform.BeginAnimation(RotateTransform.AngleProperty, keyTurn);
                        }

                        // Unlock card visual transition
                        lockIcon.Text = "🔓 ";
                        lockIcon.Foreground = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1));
                        cardBorderBrush.Color = Color.FromRgb(0xA6, 0xE3, 0xA1);
                        subText.Text = "✨ UNBLOCKED & READY!";
                        subText.Foreground = new SolidColorBrush(Color.FromRgb(0xA6, 0xE3, 0xA1));

                        // Card joyful bounce
                        var cardBounce = new DoubleAnimation(1, 1.15, TimeSpan.FromMilliseconds(200))
                        {
                            AutoReverse = true,
                            EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 3 }
                        };
                        cardScale.BeginAnimation(ScaleTransform.ScaleXProperty, cardBounce);
                        cardScale.BeginAnimation(ScaleTransform.ScaleYProperty, cardBounce);

                        // Sparkle star shower
                        SpawnUnblockSparks(canvas, new Point(targetPos.X + 20, targetPos.Y + 10));
                    };
                    unlockTimer.Start();

                    // Step 4: Victory Dash off the screen (lingering celebration)
                    int exitDelay = sprintDuration + 2000;
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
                            BeginTime = TimeSpan.FromMilliseconds(400)
                        };
                        charTranslate.BeginAnimation(TranslateTransform.XProperty, exitX);
                        bunny.BeginAnimation(UIElement.OpacityProperty, exitFade);
                        bubble.BeginAnimation(UIElement.OpacityProperty, exitFade);

                        var cardFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(600));
                        issueCard.BeginAnimation(UIElement.OpacityProperty, cardFade);
                    };
                    exitTimer.Start();

                    // Step 5: Clean up canvas
                    int totalDuration = exitDelay + 1400;
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

        private static void SpawnUnblockSparks(Canvas canvas, Point center)
        {
            int sparkCount = 28;
            for (int i = 0; i < sparkCount; i++)
            {
                var color = UnblockSparkColors[Rng.Next(UnblockSparkColors.Length)];
                bool isStar = i % 3 == 0;

                FrameworkElement spark;
                if (isStar)
                {
                    // 4-pointed sparkle star
                    spark = new Path
                    {
                        Fill = new SolidColorBrush(color),
                        Data = Geometry.Parse("M 0,-7 Q 0,0 7,0 Q 0,0 0,7 Q 0,0 -7,0 Q 0,0 0,-7 Z")
                    };
                }
                else
                {
                    double size = Rng.Next(4, 9);
                    spark = new Ellipse
                    {
                        Width = size,
                        Height = size,
                        Fill = new SolidColorBrush(color)
                    };
                }

                var transform = new TransformGroup();
                var translate = new TranslateTransform();
                var rotate = new RotateTransform(0);
                var scale = new ScaleTransform(1, 1);
                transform.Children.Add(translate);
                transform.Children.Add(rotate);
                transform.Children.Add(scale);
                spark.RenderTransform = transform;
                spark.RenderTransformOrigin = new Point(0.5, 0.5);

                Canvas.SetLeft(spark, center.X);
                Canvas.SetTop(spark, center.Y);
                canvas.Children.Add(spark);

                double angle = Rng.NextDouble() * 2 * Math.PI;
                double distance = Rng.Next(40, 140);
                double destX = Math.Cos(angle) * distance;
                double destY = Math.Sin(angle) * distance - Rng.Next(10, 40); // bias upward

                int duration = Rng.Next(350, 650);

                var animX = new DoubleAnimation(0, destX, TimeSpan.FromMilliseconds(duration))
                {
                    EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                };
                var animY = new DoubleAnimation(0, destY, TimeSpan.FromMilliseconds(duration))
                {
                    EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                };
                var animRot = new DoubleAnimation(0, Rng.Next(-180, 180), TimeSpan.FromMilliseconds(duration));
                var animFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(duration * 0.5))
                {
                    BeginTime = TimeSpan.FromMilliseconds(duration * 0.5)
                };

                translate.BeginAnimation(TranslateTransform.XProperty, animX);
                translate.BeginAnimation(TranslateTransform.YProperty, animY);
                rotate.BeginAnimation(RotateTransform.AngleProperty, animRot);
                spark.BeginAnimation(UIElement.OpacityProperty, animFade);
            }
        }

        private static (FrameworkElement mascot, RotateTransform keyTransform) BuildUnblockBunnyMascot()
        {
            var root = new Canvas { Width = 64, Height = 64 };

            // Long bunny ears (golden cream with soft pink inner ear)
            var earL = new Path
            {
                Fill = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                Data = Geometry.Parse("M 14,26 C 6,14 8,0 18,2 C 24,4 24,18 20,26 Z")
            };
            var earLInner = new Path
            {
                Fill = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                Opacity = 0.7,
                Data = Geometry.Parse("M 14,24 C 9,15 10,5 17,6 C 21,8 21,18 18,24 Z")
            };
            root.Children.Add(earL);
            root.Children.Add(earLInner);

            var earR = new Path
            {
                Fill = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                Data = Geometry.Parse("M 30,26 C 26,14 30,0 40,2 C 48,4 44,18 36,26 Z")
            };
            var earRInner = new Path
            {
                Fill = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                Opacity = 0.7,
                Data = Geometry.Parse("M 31,24 C 28,15 32,5 39,6 C 44,8 41,18 36,24 Z")
            };
            root.Children.Add(earR);
            root.Children.Add(earRInner);

            // Fluffy round head
            var head = new Ellipse
            {
                Width = 44,
                Height = 38,
                Fill = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF))
            };
            Canvas.SetLeft(head, 8);
            Canvas.SetTop(head, 20);
            root.Children.Add(head);

            // Sparkling anime eyes with white sparkle highlights
            var eyeL = new Ellipse { Width = 7, Height = 9, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(eyeL, 16);
            Canvas.SetTop(eyeL, 30);
            root.Children.Add(eyeL);

            var eyeLSparkle = new Ellipse { Width = 3, Height = 3, Fill = Brushes.White };
            Canvas.SetLeft(eyeLSparkle, 17);
            Canvas.SetTop(eyeLSparkle, 31);
            root.Children.Add(eyeLSparkle);

            var eyeR = new Ellipse { Width = 7, Height = 9, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(eyeR, 34);
            Canvas.SetTop(eyeR, 30);
            root.Children.Add(eyeR);

            var eyeRSparkle = new Ellipse { Width = 3, Height = 3, Fill = Brushes.White };
            Canvas.SetLeft(eyeRSparkle, 35);
            Canvas.SetTop(eyeRSparkle, 31);
            root.Children.Add(eyeRSparkle);

            // Rosy cheeks
            var cheekL = new Ellipse { Width = 8, Height = 5, Fill = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)), Opacity = 0.65 };
            Canvas.SetLeft(cheekL, 11);
            Canvas.SetTop(cheekL, 38);
            root.Children.Add(cheekL);

            var cheekR = new Ellipse { Width = 8, Height = 5, Fill = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)), Opacity = 0.65 };
            Canvas.SetLeft(cheekR, 38);
            Canvas.SetTop(cheekR, 38);
            root.Children.Add(cheekR);

            // Cute little nose & mouth
            var nose = new Path
            {
                Fill = new SolidColorBrush(Color.FromRgb(0xF3, 0x8B, 0xA8)),
                Data = Geometry.Parse("M 27,38 L 31,38 L 29,40 Z")
            };
            root.Children.Add(nose);

            var mouth = new Path
            {
                Stroke = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)),
                StrokeThickness = 1.2,
                Data = Geometry.Parse("M 25,41 Q 29,44 29,41 Q 29,44 33,41")
            };
            root.Children.Add(mouth);

            // Shiny golden key held in paw with articulation
            var keyCanvas = new Canvas { Width = 28, Height = 28 };
            var keyPath = new Path
            {
                Fill = new SolidColorBrush(Color.FromRgb(0xFA, 0xB3, 0x87)),
                Stroke = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                StrokeThickness = 1.2,
                Data = Geometry.Parse("M 8,4 A 4,4 0 1,1 8,12 A 4,4 0 0,1 8,4 M 8,7 A 1.5,1.5 0 1,0 8,10 A 1.5,1.5 0 0,0 8,7 M 12,8 L 24,8 L 24,12 L 21,12 L 21,8 L 18,8 L 18,11 L 16,11 L 16,8 Z")
            };
            keyCanvas.Children.Add(keyPath);

            var keyRotate = new RotateTransform(15);
            keyCanvas.RenderTransform = keyRotate;
            keyCanvas.RenderTransformOrigin = new Point(0.3, 0.3);

            Canvas.SetLeft(keyCanvas, 38);
            Canvas.SetTop(keyCanvas, 32);
            root.Children.Add(keyCanvas);

            return (root, keyRotate);
        }
    }
}

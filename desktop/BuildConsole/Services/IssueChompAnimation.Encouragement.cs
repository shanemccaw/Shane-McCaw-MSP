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
    /// Random Encouragement Critter: A BIG critter (2.4x scale) strolls across the screen,
    /// pauses to celebrate and cheer you on with motivating signs ("37% of the way there! Way to go! Get some ice cream! 🍦"),
    /// spawns floating hearts & sparkle stars, and happily prances off.
    /// </summary>
    public static partial class IssueChompAnimation
    {
        private static readonly (string Header, string Subtitle, string Icon)[] EncouragementMessages =
        {
            ("Way to go! 🎯", "37% of the way there! Get some ice cream! 🍦", "🍦"),
            ("Crushing it! 🚀", "Awesome progress today! Treat yourself to a snack! 🍪", "⭐"),
            ("You're on fire! 🔥", "Making huge strides! Time for a coffee break? ☕", "☕"),
            ("Halfway to glory! 🌟", "Keep up the momentum! You're a rockstar! 🎸", "✨"),
            ("Great work, Shane! 💪", "Take a breath, stretch, and stay hydrated! 💧", "🎉"),
            ("Milestone in sight! 🏆", "Every issue closed is a victory! Way to go! 🎈", "🍰"),
            ("High five! ✋", "Phenomenal hustle today! Keep rocking it! ⚡", "🌟"),
            ("Path is looking clear! 🌈", "Super proud of this codebase progress! 🍕", "🍕"),
            ("Level Up! 🎮", "Bug-hunting champion of the day! Get some treats! 🍩", "🍩"),
        };

        private static readonly Color[] EncouragementSparkColors =
        {
            Color.FromRgb(0xF9, 0xE2, 0xAF), // Golden yellow
            Color.FromRgb(0xFA, 0xB3, 0x87), // Peach / orange
            Color.FromRgb(0xF3, 0x8B, 0xA8), // Strawberry pink
            Color.FromRgb(0xA6, 0xE3, 0xA1), // Mint green
            Color.FromRgb(0x89, 0xB4, 0xFA), // Sky blue
            Color.FromRgb(0xCB, 0xA6, 0xF7), // Mauve
            Color.FromRgb(0xFF, 0xFF, 0xFF), // Pure white spark
        };

        /// <summary>
        /// Plays a random Big Encouragement Critter walk-around animation with uplifting signs & sparkles.
        /// </summary>
        public static void PlayEncouragement(string? customHeader = null, string? customSubtitle = null)
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

                    // Choose walk direction: Left-to-Right or Right-to-Left
                    bool walkLeftToRight = Rng.Next(2) == 0;

                    // Pick random encouragement message or use custom
                    var randomMsg = EncouragementMessages[Rng.Next(EncouragementMessages.Length)];
                    string headerText = customHeader ?? randomMsg.Header;
                    string subtitleText = customSubtitle ?? randomMsg.Subtitle;

                    // Pick random mascot (0-5: Fox, Bear, Cat, Bird, Sprocket, or Bunny)
                    int mascotIndex = Rng.Next(6);
                    FrameworkElement mascot;
                    if (mascotIndex == 5)
                    {
                        var (bunny, _) = BuildUnblockBunnyMascot();
                        mascot = bunny;
                    }
                    else
                    {
                        var (m, _) = BuildMascot(mascotIndex);
                        mascot = m;
                    }

                    // Big Critter Scale with golden aura
                    double critterScale = 2.4;
                    mascot.Effect = new DropShadowEffect
                    {
                        Color = Color.FromRgb(0xF9, 0xE2, 0xAF),
                        BlurRadius = 32,
                        ShadowDepth = 0,
                        Opacity = 0.95
                    };

                    // Screen position: lower third (above taskbar/status bar)
                    double walkY = Math.Clamp(winH * 0.65, 160, winH - 180);
                    double centerPauseX = winW * (0.35 + (Rng.NextDouble() * 0.25)); // between 35% and 60% of screen width

                    double startX = walkLeftToRight ? -100 : (winW + 100);
                    double endX = walkLeftToRight ? (winW + 120) : -120;

                    Canvas.SetLeft(mascot, startX);
                    Canvas.SetTop(mascot, walkY);
                    canvas.Children.Add(mascot);

                    var charTransform = new TransformGroup();
                    var charTranslate = new TranslateTransform();
                    var charHopTranslate = new TranslateTransform();
                    var charWiggleRotate = new RotateTransform(0);
                    // Face direction of travel
                    var charScaleTransform = new ScaleTransform(walkLeftToRight ? critterScale : -critterScale, critterScale);
                    charTransform.Children.Add(charScaleTransform);
                    charTransform.Children.Add(charTranslate);
                    charTransform.Children.Add(charHopTranslate);
                    charTransform.Children.Add(charWiggleRotate);
                    mascot.RenderTransform = charTransform;
                    mascot.RenderTransformOrigin = new Point(0.5, 0.5);

                    // Cheerful Speech Bubble / Banner Card
                    var bubble = new Border
                    {
                        Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E)),
                        BorderBrush = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                        BorderThickness = new Thickness(2.5),
                        CornerRadius = new CornerRadius(16),
                        Padding = new Thickness(18, 12, 18, 12),
                        Effect = new DropShadowEffect
                        {
                            BlurRadius = 24,
                            ShadowDepth = 3,
                            Opacity = 0.85,
                            Color = Color.FromRgb(0xF9, 0xE2, 0xAF)
                        },
                        Opacity = 0,
                        RenderTransformOrigin = new Point(0.5, 0.5)
                    };
                    var bubbleScale = new ScaleTransform(0.2, 0.2);
                    bubble.RenderTransform = bubbleScale;

                    var bubbleStack = new StackPanel();
                    var headerBlock = new TextBlock
                    {
                        Text = headerText,
                        Foreground = new SolidColorBrush(Color.FromRgb(0xF9, 0xE2, 0xAF)),
                        FontSize = 14,
                        FontWeight = FontWeights.ExtraBold,
                        HorizontalAlignment = HorizontalAlignment.Center
                    };
                    bubbleStack.Children.Add(headerBlock);

                    var subBlock = new TextBlock
                    {
                        Text = subtitleText,
                        Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                        FontSize = 12.5,
                        FontWeight = FontWeights.Bold,
                        Margin = new Thickness(0, 4, 0, 0),
                        HorizontalAlignment = HorizontalAlignment.Center
                    };
                    bubbleStack.Children.Add(subBlock);
                    bubble.Child = bubbleStack;

                    Canvas.SetLeft(bubble, Math.Clamp(centerPauseX - 120, 40, winW - 320));
                    Canvas.SetTop(bubble, walkY - 95);
                    canvas.Children.Add(bubble);

                    // Step 1: Leisurely walk from off-screen to the center
                    double walkToCenterDist = centerPauseX - startX;
                    int walkDuration = 2600;

                    var walkAnim = new DoubleAnimation(0, walkToCenterDist, TimeSpan.FromMilliseconds(walkDuration))
                    {
                        EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                    };
                    charTranslate.BeginAnimation(TranslateTransform.XProperty, walkAnim);

                    // Joyful rhythmic walking hops
                    var hopAnim = new DoubleAnimation(0, -22, TimeSpan.FromMilliseconds(220))
                    {
                        AutoReverse = true,
                        RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(walkDuration)),
                        EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                    };
                    charHopTranslate.BeginAnimation(TranslateTransform.YProperty, hopAnim);

                    // Step 2: Pause in center, pop speech bubble, spawn sparkles & wiggle
                    int pauseDelay = walkDuration;
                    var pauseTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(pauseDelay) };
                    pauseTimer.Tick += (_, _) =>
                    {
                        pauseTimer.Stop();

                        // Pop speech bubble with elastic bounce
                        var bubbleOpacity = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(250));
                        var popScale = new DoubleAnimation(0.2, 1.15, TimeSpan.FromMilliseconds(350))
                        {
                            EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 4 }
                        };
                        bubble.BeginAnimation(UIElement.OpacityProperty, bubbleOpacity);
                        bubbleScale.BeginAnimation(ScaleTransform.ScaleXProperty, popScale);
                        bubbleScale.BeginAnimation(ScaleTransform.ScaleYProperty, popScale);

                        // Happy wiggle / happy dance
                        var wiggle = new DoubleAnimation(-8, 8, TimeSpan.FromMilliseconds(180))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(5000)),
                            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                        };
                        charWiggleRotate.BeginAnimation(RotateTransform.AngleProperty, wiggle);

                        // Spawn cheerful floating sparkle stars & confetti
                        SpawnEncouragementSparks(canvas, new Point(centerPauseX + 20, walkY));
                    };
                    pauseTimer.Start();

                    // Step 3: Resume walking and exit off the screen
                    int exitDelay = walkDuration + 5500; // displays banner for 5.5 seconds
                    var exitTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(exitDelay) };
                    exitTimer.Tick += (_, _) =>
                    {
                        exitTimer.Stop();

                        // Fade speech bubble
                        var bubbleFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(450));
                        bubble.BeginAnimation(UIElement.OpacityProperty, bubbleFade);

                        // Walk from center to exit
                        double finalWalkDist = endX - startX;
                        int exitWalkDuration = 2600;

                        var exitWalkAnim = new DoubleAnimation(walkToCenterDist, finalWalkDist, TimeSpan.FromMilliseconds(exitWalkDuration))
                        {
                            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
                        };
                        var mascotFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(500))
                        {
                            BeginTime = TimeSpan.FromMilliseconds(exitWalkDuration - 500)
                        };

                        charTranslate.BeginAnimation(TranslateTransform.XProperty, exitWalkAnim);
                        mascot.BeginAnimation(UIElement.OpacityProperty, mascotFade);

                        // Resumed walking hops
                        var exitHopAnim = new DoubleAnimation(0, -22, TimeSpan.FromMilliseconds(220))
                        {
                            AutoReverse = true,
                            RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(exitWalkDuration)),
                            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                        };
                        charHopTranslate.BeginAnimation(TranslateTransform.YProperty, exitHopAnim);
                    };
                    exitTimer.Start();

                    // Cleanup session after animation finishes
                    var cleanupTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(walkDuration + 5500 + 2800) };
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

        private static void SpawnEncouragementSparks(Canvas canvas, Point center)
        {
            int count = 26;
            for (int i = 0; i < count; i++)
            {
                var color = EncouragementSparkColors[Rng.Next(EncouragementSparkColors.Length)];
                bool isStar = i % 2 == 0;

                FrameworkElement spark;
                if (isStar)
                {
                    spark = new Path
                    {
                        Fill = new SolidColorBrush(color),
                        Data = Geometry.Parse("M 0,-8 Q 0,0 8,0 Q 0,0 0,8 Q 0,0 -8,0 Q 0,0 0,-8 Z")
                    };
                }
                else
                {
                    double size = Rng.Next(5, 10);
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
                transform.Children.Add(translate);
                transform.Children.Add(rotate);
                spark.RenderTransform = transform;
                spark.RenderTransformOrigin = new Point(0.5, 0.5);

                Canvas.SetLeft(spark, center.X);
                Canvas.SetTop(spark, center.Y);
                canvas.Children.Add(spark);

                double angle = Rng.NextDouble() * 2 * Math.PI;
                double distance = Rng.Next(50, 160);
                double destX = Math.Cos(angle) * distance;
                double destY = Math.Sin(angle) * distance - Rng.Next(30, 80); // upward float

                int duration = Rng.Next(500, 1000);
                int delay = Rng.Next(0, 1800); // spread over the celebration duration

                var animX = new DoubleAnimation(0, destX, TimeSpan.FromMilliseconds(duration))
                {
                    BeginTime = TimeSpan.FromMilliseconds(delay),
                    EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                };
                var animY = new DoubleAnimation(0, destY, TimeSpan.FromMilliseconds(duration))
                {
                    BeginTime = TimeSpan.FromMilliseconds(delay),
                    EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut }
                };
                var animRot = new DoubleAnimation(0, Rng.Next(-240, 240), TimeSpan.FromMilliseconds(duration))
                {
                    BeginTime = TimeSpan.FromMilliseconds(delay)
                };
                var animFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(duration * 0.6))
                {
                    BeginTime = TimeSpan.FromMilliseconds(delay + duration * 0.4)
                };

                translate.BeginAnimation(TranslateTransform.XProperty, animX);
                translate.BeginAnimation(TranslateTransform.YProperty, animY);
                rotate.BeginAnimation(RotateTransform.AngleProperty, animRot);
                spark.BeginAnimation(UIElement.OpacityProperty, animFade);
            }
        }
    }
}

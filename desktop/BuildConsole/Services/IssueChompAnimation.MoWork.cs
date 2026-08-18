using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;

namespace BuildConsole.Services
{
    /// <summary>
    /// Split into its own partial-class file specifically to avoid fighting
    /// over IssueChompAnimation.cs — that file was being live-reverted
    /// moments after every edit while this feature was being built (Shane
    /// had it open elsewhere and kept saving over it), so this new method
    /// lands here instead, in a file nothing else touches. Same pattern as
    /// the earlier "new-partial-class-file trick avoids shared-file
    /// contention" precedent used for Git Board detail tabs.
    /// </summary>
    public static partial class IssueChompAnimation
    {
        // ══════════════════════════════════════════════════════════════════════
        // MO' WORK GRUMP (New Issue Created — sad, grumpy, dejected trudge-in)
        // Shane: "More work is added with new Issues created... This little
        // guy should be grumpy, sad... Mo Work! Think Warcraft (before World
        // of Warcraft) when you would click on Ogre and he'd say 'Mo Work!'"
        // Deliberately the ANTI-celebration: every other critter in
        // IssueChompAnimation.cs sprints/charges in fast and dashes off
        // triumphant; this one shuffles in slow and heavy, groans, slumps,
        // and trudges off unhappily — kicking up a puff of dust instead of
        // confetti.
        // ══════════════════════════════════════════════════════════════════════
        private static readonly string[] MoWorkPhrases =
        {
            "MO' WORK!", "UGH... MORE?", "*sigh* AGAIN?", "WORK NEVER ENDS...", "WHY MEEE?", "NOT ANOTHER ONE...", "MORE WORK. GREAT."
        };

        public static void PlayMoWork(FrameworkElement? targetElement, string issueTitle)
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

                    // Floating "new issue" card — muted gray, not a celebration color
                    var issueCard = new Border
                    {
                        Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E)),
                        BorderBrush = new SolidColorBrush(Color.FromRgb(0xA6, 0xAD, 0xC8)),
                        BorderThickness = new Thickness(1.5),
                        CornerRadius = new CornerRadius(6),
                        Padding = new Thickness(10, 6, 10, 6),
                        Effect = new DropShadowEffect { BlurRadius = 14, ShadowDepth = 2, Opacity = 0.6, Color = Colors.Black },
                        RenderTransformOrigin = new Point(0.5, 0.5)
                    };
                    var cardScale = new ScaleTransform(0.2, 0.2);
                    issueCard.RenderTransform = cardScale;
                    issueCard.Child = new TextBlock
                    {
                        Text = "🆕 " + (issueTitle.Length > 32 ? issueTitle.Substring(0, 29) + "…" : issueTitle),
                        Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                        FontSize = 11.5,
                        FontWeight = FontWeights.Bold
                    };
                    Canvas.SetLeft(issueCard, targetPos.X - 65);
                    Canvas.SetTop(issueCard, targetPos.Y - 18);
                    canvas.Children.Add(issueCard);

                    var cardPop = new DoubleAnimation(0.2, 1, TimeSpan.FromMilliseconds(250)) { EasingFunction = new BackEase { Amplitude = 1.5, EasingMode = EasingMode.EaseOut } };
                    cardScale.BeginAnimation(ScaleTransform.ScaleXProperty, cardPop);
                    cardScale.BeginAnimation(ScaleTransform.ScaleYProperty, cardPop);

                    // Grumpy mascot
                    var grump = BuildGrumpMascot();
                    double grumpScale = 1.5;
                    var charTransform = new TransformGroup();
                    var charTranslate = new TranslateTransform();
                    var charShuffleTranslate = new TranslateTransform();
                    // Face LEFT (starts on far right, shuffles left toward the new issue)
                    var charScaleTransform = new ScaleTransform(-grumpScale, grumpScale);
                    charTransform.Children.Add(charScaleTransform);
                    charTransform.Children.Add(charTranslate);
                    charTransform.Children.Add(charShuffleTranslate);
                    grump.RenderTransform = charTransform;
                    grump.RenderTransformOrigin = new Point(0.5, 0.5);

                    double winW = mainWin.ActualWidth;
                    double startX = winW + 40;
                    double startY = targetPos.Y - 30;
                    Canvas.SetLeft(grump, startX);
                    Canvas.SetTop(grump, startY);
                    canvas.Children.Add(grump);

                    // Speech bubble (a groan, not a cheer)
                    var bubble = new Border
                    {
                        Background = new SolidColorBrush(Color.FromRgb(0x6C, 0x70, 0x86)),
                        BorderBrush = new SolidColorBrush(Color.FromRgb(0x45, 0x47, 0x5A)),
                        BorderThickness = new Thickness(1.5),
                        CornerRadius = new CornerRadius(12),
                        Padding = new Thickness(10, 5, 10, 5),
                        Opacity = 0,
                        RenderTransformOrigin = new Point(0.5, 0.5)
                    };
                    var bubbleScale = new ScaleTransform(0.2, 0.2);
                    bubble.RenderTransform = bubbleScale;
                    var bubbleText = new TextBlock
                    {
                        Text = MoWorkPhrases[Rng.Next(MoWorkPhrases.Length)],
                        Foreground = Brushes.White,
                        FontSize = 12,
                        FontWeight = FontWeights.Black
                    };
                    bubble.Child = bubbleText;
                    Canvas.SetLeft(bubble, targetPos.X - 45);
                    Canvas.SetTop(bubble, targetPos.Y - 68);
                    canvas.Children.Add(bubble);

                    // Step 1: a SLOW, heavy shuffle — deliberately slow and readable
                    double targetArrivalX = targetPos.X + 40;
                    double shuffleDistance = targetArrivalX - startX;
                    int shuffleDuration = 2400;

                    var shuffleX = new DoubleAnimation(0, shuffleDistance, TimeSpan.FromMilliseconds(shuffleDuration))
                    {
                        EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                    };
                    charTranslate.BeginAnimation(TranslateTransform.XProperty, shuffleX);

                    // Low, heavy shuffle-hop — much smaller amplitude than the peppy critters' gallop
                    var shuffleHop = new DoubleAnimation(0, -6, TimeSpan.FromMilliseconds(260))
                    {
                        AutoReverse = true,
                        RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(shuffleDuration)),
                        EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                    };
                    charShuffleTranslate.BeginAnimation(TranslateTransform.YProperty, shuffleHop);

                    // Step 2: groan bubble pops on arrival
                    int bubblePopDelay = Math.Max(100, shuffleDuration - 200);
                    var popOpacity = new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(250)) { BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay) };
                    var popScale = new DoubleAnimation(0.2, 1.05, TimeSpan.FromMilliseconds(300))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(bubblePopDelay),
                        EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 3 }
                    };
                    bubble.BeginAnimation(UIElement.OpacityProperty, popOpacity);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleXProperty, popScale);
                    bubbleScale.BeginAnimation(ScaleTransform.ScaleYProperty, popScale);

                    // Step 3: shoulders slump, a resigned puff of dust kicks up — lingers so it's readable
                    int slumpDelay = shuffleDuration;
                    var slumpTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(slumpDelay) };
                    slumpTimer.Tick += (_, _) =>
                    {
                        slumpTimer.Stop();
                        var slump = new DoubleAnimation(grumpScale, grumpScale * 0.9, TimeSpan.FromMilliseconds(300))
                        {
                            AutoReverse = true,
                            EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
                        };
                        charScaleTransform.BeginAnimation(ScaleTransform.ScaleYProperty, slump);
                        SpawnGrumpDust(canvas, new Point(targetPos.X + 15, targetPos.Y + 32));
                    };
                    slumpTimer.Start();

                    // Step 4: trudges off — slow fade, lingering for a moment
                    int exitDelay = shuffleDuration + 2000;
                    var exitTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(exitDelay) };
                    exitTimer.Tick += (_, _) =>
                    {
                        exitTimer.Stop();
                        double exitDistance = shuffleDistance - (targetPos.X + 220);
                        var exitX = new DoubleAnimation(shuffleDistance, exitDistance, TimeSpan.FromMilliseconds(1800))
                        {
                            EasingFunction = new SineEase { EasingMode = EasingMode.EaseIn }
                        };
                        var exitFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(900))
                        {
                            BeginTime = TimeSpan.FromMilliseconds(900)
                        };
                        charTranslate.BeginAnimation(TranslateTransform.XProperty, exitX);
                        grump.BeginAnimation(UIElement.OpacityProperty, exitFade);
                        bubble.BeginAnimation(UIElement.OpacityProperty, exitFade);

                        var cardFade = new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(900));
                        issueCard.BeginAnimation(UIElement.OpacityProperty, cardFade);
                    };
                    exitTimer.Start();

                    // Step 5: clean up
                    int totalDuration = exitDelay + 2000;
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

        private static void SpawnGrumpDust(Canvas canvas, Point center)
        {
            Color[] dustColors = { Color.FromRgb(0x6C, 0x70, 0x86), Color.FromRgb(0x9C, 0xA0, 0xB0), Color.FromRgb(0x45, 0x47, 0x5A) };
            for (int i = 0; i < 10; i++)
            {
                double angle = (i / 10.0) * Math.PI + Math.PI; // fans out low/downward — a kicked-up puff, not an explosive burst
                double speed = Rng.Next(20, 50);
                double destX = center.X + Math.Cos(angle) * speed;
                double destY = center.Y + Math.Sin(angle) * speed * 0.4;

                var particle = new Ellipse
                {
                    Width = Rng.Next(6, 14),
                    Height = Rng.Next(6, 14),
                    Fill = new SolidColorBrush(dustColors[Rng.Next(dustColors.Length)]),
                    Opacity = 0.6
                };
                var trans = new TranslateTransform();
                particle.RenderTransform = trans;
                Canvas.SetLeft(particle, center.X);
                Canvas.SetTop(particle, center.Y);
                canvas.Children.Add(particle);

                var animX = new DoubleAnimation(0, destX - center.X, TimeSpan.FromMilliseconds(600)) { EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut } };
                var animY = new DoubleAnimation(0, destY - center.Y, TimeSpan.FromMilliseconds(600)) { EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut } };
                var fade = new DoubleAnimation(0.6, 0, TimeSpan.FromMilliseconds(600)) { BeginTime = TimeSpan.FromMilliseconds(100) };

                trans.BeginAnimation(TranslateTransform.XProperty, animX);
                trans.BeginAnimation(TranslateTransform.YProperty, animY);
                particle.BeginAnimation(UIElement.OpacityProperty, fade);
            }
        }

        private static FrameworkElement BuildGrumpMascot()
        {
            var canvas = new Canvas { Width = 62, Height = 58 };

            // Droopy ears
            var earL = new Ellipse { Width = 12, Height = 18, Fill = new SolidColorBrush(Color.FromRgb(0x6B, 0x8E, 0x5A)) };
            Canvas.SetLeft(earL, 2);
            Canvas.SetTop(earL, 18);
            canvas.Children.Add(earL);
            var earR = new Ellipse { Width = 12, Height = 18, Fill = new SolidColorBrush(Color.FromRgb(0x6B, 0x8E, 0x5A)) };
            Canvas.SetLeft(earR, 48);
            Canvas.SetTop(earR, 18);
            canvas.Children.Add(earR);

            // Olive-green grumpy head
            var head = new Ellipse { Width = 46, Height = 42, Fill = new SolidColorBrush(Color.FromRgb(0x7C, 0x9A, 0x6B)) };
            Canvas.SetLeft(head, 8);
            Canvas.SetTop(head, 10);
            canvas.Children.Add(head);

            // Small tusks
            var tuskL = new Polygon { Points = new PointCollection { new Point(20, 36), new Point(17, 44), new Point(24, 38) }, Fill = Brushes.Ivory };
            var tuskR = new Polygon { Points = new PointCollection { new Point(38, 36), new Point(41, 44), new Point(34, 38) }, Fill = Brushes.Ivory };
            canvas.Children.Add(tuskL);
            canvas.Children.Add(tuskR);

            // Heavy, furrowed brows angled DOWN toward the nose — the "grump" tell
            var browL = new Path { Stroke = new SolidColorBrush(Color.FromRgb(0x2E, 0x3A, 0x25)), StrokeThickness = 2.5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Data = Geometry.Parse("M 16,22 L 25,26") };
            var browR = new Path { Stroke = new SolidColorBrush(Color.FromRgb(0x2E, 0x3A, 0x25)), StrokeThickness = 2.5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Data = Geometry.Parse("M 38,22 L 29,26") };
            canvas.Children.Add(browL);
            canvas.Children.Add(browR);

            // Small, half-lidded tired eyes
            var eyeL = new Ellipse { Width = 5, Height = 3, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            var eyeR = new Ellipse { Width = 5, Height = 3, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(eyeL, 19);
            Canvas.SetTop(eyeL, 27);
            Canvas.SetLeft(eyeR, 34);
            Canvas.SetTop(eyeR, 27);
            canvas.Children.Add(eyeL);
            canvas.Children.Add(eyeR);

            // Downturned frown
            var frown = new Path { Stroke = new SolidColorBrush(Color.FromRgb(0x2E, 0x3A, 0x25)), StrokeThickness = 2, Data = Geometry.Parse("M 22,38 Q 31,33 40,38") };
            canvas.Children.Add(frown);

            return canvas;
        }
    }
}

using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// The immersive Focus view's playful ambient/celebration layer — Microsoft-Clarity's
    /// "animal companion" spirit rebuilt with original emoji + WPF motion. Small cute companions
    /// stroll the bottom border and peek in from the corners while you work; real milestone events
    /// (a build completing, issues closing) trigger a tasteful confetti/trophy celebration. Same
    /// lighthearted register as Build Watch's "Reticulating splines…" easter egg — a wink, not a
    /// slot machine. Never interactive (the control is <c>IsHitTestVisible=False</c>).
    ///
    /// Every visible trigger is logged on the <c>focus-mode</c> ActivityLog channel so the animation
    /// activity is attributable/verifiable, exactly like the rest of Focus Mode.
    /// </summary>
    public partial class FocusCharacterLayer : UserControl
    {
        private readonly Random _rng = new();
        private DispatcherTimer? _ambient;
        private bool _running;

        // A small cast of friendly companions (original — not Clarity's actual assets).
        private static readonly string[] Companions = { "🦊", "🐢", "🦉", "🐿️", "🦫", "🐥", "🐸" };
        private static readonly string[] Confetti = { "🎉", "🎊", "✨", "⭐", "🎈" };
        private static readonly string[] ConfettiBrushKeys =
            { "BlueBrush", "MauveBrush", "GreenBrush", "PeachBrush", "YellowBrush", "RedBrush" };

        public FocusCharacterLayer()
        {
            InitializeComponent();
        }

        /// <summary>Begin the ambient companion loop (called when the immersive view is shown).</summary>
        public void Start()
        {
            if (_running) return;
            _running = true;
            _ambient = new DispatcherTimer(DispatcherPriority.Background, Dispatcher)
            {
                Interval = TimeSpan.FromSeconds(6) // first companion wanders in shortly after entering
            };
            _ambient.Tick += (_, _) => AmbientTick();
            _ambient.Start();
        }

        /// <summary>Stop everything and clear the stage (called when the immersive view is hidden).</summary>
        public void Stop()
        {
            _running = false;
            _ambient?.Stop();
            _ambient = null;
            Stage.Children.Clear();
        }

        // ----------------------------------------------------------------
        // Ambient loop
        // ----------------------------------------------------------------
        private void AmbientTick()
        {
            // Re-randomise the next interval so the companions feel organic, not metronomic.
            if (_ambient != null)
                _ambient.Interval = TimeSpan.FromSeconds(24 + _rng.Next(0, 46)); // 24–70s
            if (!_running || ActualWidth < 60 || ActualHeight < 60) return;

            if (_rng.NextDouble() < 0.28) PeekFromEdge();
            else Stroll();
        }

        private void Stroll()
        {
            string glyph = Companions[_rng.Next(Companions.Length)];
            double size = 22 + _rng.Next(0, 8);
            bool leftToRight = _rng.NextDouble() < 0.5;
            double y = ActualHeight - size - 14 - _rng.Next(0, 30); // hug the bottom border, a little variance
            double startX = leftToRight ? -size - 10 : ActualWidth + size + 10;
            double endX = leftToRight ? ActualWidth + size + 10 : -size - 10;

            var (tb, translate, rotate, scale) = AddGlyph(glyph, size, startX, y);
            if (!leftToRight) scale.ScaleX = -1; // face the way it's walking

            double dur = 7.5 + _rng.NextDouble() * 4.0; // 7.5–11.5s: an unhurried amble
            var walk = new DoubleAnimation(startX, endX, TimeSpan.FromSeconds(dur))
            { EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            walk.Completed += (_, _) => Stage.Children.Remove(tb);

            var bob = new DoubleAnimation(0, -6, TimeSpan.FromSeconds(0.6))
            { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            var waddle = new DoubleAnimation(-7, 7, TimeSpan.FromSeconds(0.9))
            { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };

            tb.BeginAnimation(Canvas.LeftProperty, walk);
            translate.BeginAnimation(TranslateTransform.YProperty, bob);
            rotate.BeginAnimation(RotateTransform.AngleProperty, waddle);
            FadeIn(tb);
            ActivityLog.Log("focus-mode", $"immersive ambient: {glyph} companion strolled across the border");
        }

        private void PeekFromEdge()
        {
            string glyph = Companions[_rng.Next(Companions.Length)];
            double size = 24;
            bool leftCorner = _rng.NextDouble() < 0.5;
            double x = leftCorner ? 18 : ActualWidth - size - 18;
            double hidden = ActualHeight + size;
            double shown = ActualHeight - size - 8;

            var (tb, _, rotate, scale) = AddGlyph(glyph, size, x, hidden);
            if (!leftCorner) scale.ScaleX = -1;

            var pop = new DoubleAnimationUsingKeyFrames();
            pop.KeyFrames.Add(new EasingDoubleKeyFrame(hidden, KeyTime.FromTimeSpan(TimeSpan.Zero)));
            pop.KeyFrames.Add(new EasingDoubleKeyFrame(shown, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(0.7)), new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.4 }));
            pop.KeyFrames.Add(new EasingDoubleKeyFrame(shown, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(2.6))));
            pop.KeyFrames.Add(new EasingDoubleKeyFrame(hidden, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(3.2)), new SineEase { EasingMode = EasingMode.EaseIn }));
            pop.Completed += (_, _) => Stage.Children.Remove(tb);
            tb.BeginAnimation(Canvas.TopProperty, pop);

            var wave = new DoubleAnimation(-12, 12, TimeSpan.FromSeconds(0.32))
            { AutoReverse = true, RepeatBehavior = new RepeatBehavior(5), BeginTime = TimeSpan.FromSeconds(0.7) };
            rotate.BeginAnimation(RotateTransform.AngleProperty, wave);
            FadeIn(tb);
            ActivityLog.Log("focus-mode", $"immersive ambient: {glyph} companion peeked in from the {(leftCorner ? "left" : "right")} corner");
        }

        // ----------------------------------------------------------------
        // Celebrations (real milestone events)
        // ----------------------------------------------------------------

        /// <summary>A build tied to the focused epic finished — a confetti pop + a happy hop on success,
        /// a gentle "shake it off" on failure. Never harsh.</summary>
        public void CelebrateBuildFinished(string title, bool success)
        {
            if (ActualWidth < 60 || ActualHeight < 60) return;
            if (success)
            {
                ConfettiBurst(14);
                Banner("🎉", "Build done!", Res("GreenBrush"));
                HappyHop("🦊");
            }
            else
            {
                Banner("🌧️", "Build ended — shake it off", Res("PeachBrush"));
                HappyHop("🐢");
            }
            ActivityLog.Log("focus-mode", $"immersive celebration: build {(success ? "finished ✔" : "ended")} — '{Trunc(title)}'");
        }

        /// <summary>N issue(s) closed under the focused epic — trophies float up the right border with a banner.</summary>
        public void CelebrateIssuesClosed(int count)
        {
            if (ActualWidth < 60 || ActualHeight < 60) return;
            int n = Math.Max(1, count);
            for (int i = 0; i < Math.Min(n, 5); i++)
                FloatUp(i % 2 == 0 ? "✅" : "🏆", ActualWidth - 44 - _rng.Next(0, 60), i * 150);
            Banner("🏆", n == 1 ? "Issue closed!" : $"{n} issues closed!", Res("YellowBrush"));
            ConfettiBurst(8);
            ActivityLog.Log("focus-mode", $"immersive celebration: {n} issue(s) closed under the focused epic");
        }

        /// <summary>A generic tasteful cheer (e.g. a newly-unlocked achievement) — a banner + a little confetti.</summary>
        public void Cheer(string glyph, string label)
        {
            if (ActualWidth < 60 || ActualHeight < 60) return;
            Banner(glyph, label, Res("MauveBrush"));
            ConfettiBurst(6);
            ActivityLog.Log("focus-mode", $"immersive celebration: {glyph} {Trunc(label)}");
        }

        // ----------------------------------------------------------------
        // Motion primitives
        // ----------------------------------------------------------------
        private void ConfettiBurst(int count)
        {
            double cx = ActualWidth / 2;
            for (int i = 0; i < count; i++)
            {
                var translate = new TranslateTransform();
                var rotate = new RotateTransform();
                var grp = new TransformGroup();
                grp.Children.Add(translate);
                grp.Children.Add(rotate);

                FrameworkElement piece;
                if (_rng.NextDouble() < 0.35)
                    piece = new TextBlock { Text = Confetti[_rng.Next(Confetti.Length)], FontSize = 15 + _rng.Next(0, 9) };
                else
                    piece = new Rectangle
                    {
                        Width = 7 + _rng.Next(0, 5),
                        Height = 10 + _rng.Next(0, 6),
                        Fill = Res(ConfettiBrushKeys[_rng.Next(ConfettiBrushKeys.Length)]),
                        RadiusX = 1.5,
                        RadiusY = 1.5
                    };
                piece.RenderTransformOrigin = new Point(0.5, 0.5);
                piece.RenderTransform = grp;
                Canvas.SetLeft(piece, cx + _rng.Next(-130, 130));
                Canvas.SetTop(piece, -24);
                Stage.Children.Add(piece);

                double dur = 2.2 + _rng.NextDouble() * 1.8;
                var drop = new DoubleAnimation(0, ActualHeight + 40, TimeSpan.FromSeconds(dur))
                { EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn } };
                drop.Completed += (_, _) => Stage.Children.Remove(piece);
                var drift = new DoubleAnimation(0, _rng.Next(-70, 70), TimeSpan.FromSeconds(dur))
                { EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
                var spin = new DoubleAnimation(0, _rng.Next(180, 720) * (_rng.NextDouble() < 0.5 ? -1 : 1), TimeSpan.FromSeconds(dur));

                translate.BeginAnimation(TranslateTransform.YProperty, drop);
                translate.BeginAnimation(TranslateTransform.XProperty, drift);
                rotate.BeginAnimation(RotateTransform.AngleProperty, spin);

                var fade = new DoubleAnimation(1, 0, TimeSpan.FromSeconds(0.7))
                { BeginTime = TimeSpan.FromSeconds(Math.Max(0.3, dur - 0.7)) };
                piece.BeginAnimation(UIElement.OpacityProperty, fade);
            }
        }

        private void Banner(string glyph, string label, Brush accent)
        {
            var panel = new StackPanel { Orientation = Orientation.Horizontal };
            panel.Children.Add(new TextBlock { Text = glyph, FontSize = 20, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) });
            panel.Children.Add(new TextBlock { Text = label, FontSize = 15, FontWeight = FontWeights.SemiBold, Foreground = accent, VerticalAlignment = VerticalAlignment.Center });

            var card = new Border
            {
                Background = Res("Surface0Brush"),
                BorderBrush = accent,
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(20),
                Padding = new Thickness(16, 8, 16, 8),
                Child = panel,
                Opacity = 0
            };
            var scale = new ScaleTransform(0.7, 0.7);
            var translate = new TranslateTransform();
            var grp = new TransformGroup();
            grp.Children.Add(scale);
            grp.Children.Add(translate);
            card.RenderTransformOrigin = new Point(0.5, 0.5);
            card.RenderTransform = grp;
            Stage.Children.Add(card);

            card.Measure(new Size(ActualWidth, ActualHeight));
            Canvas.SetLeft(card, (ActualWidth - card.DesiredSize.Width) / 2);
            Canvas.SetTop(card, ActualHeight * 0.6);

            var pop = new DoubleAnimation(0.7, 1.0, TimeSpan.FromSeconds(0.4))
            { EasingFunction = new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.5 } };
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, pop);
            scale.BeginAnimation(ScaleTransform.ScaleYProperty, pop);

            var op = new DoubleAnimationUsingKeyFrames();
            op.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
            op.KeyFrames.Add(new LinearDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(0.3))));
            op.KeyFrames.Add(new LinearDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(2.2))));
            op.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(3.0))));
            op.Completed += (_, _) => Stage.Children.Remove(card);
            card.BeginAnimation(UIElement.OpacityProperty, op);

            var rise = new DoubleAnimation(0, -50, TimeSpan.FromSeconds(3.0)) { EasingFunction = new SineEase { EasingMode = EasingMode.EaseOut } };
            translate.BeginAnimation(TranslateTransform.YProperty, rise);
        }

        private void HappyHop(string glyph)
        {
            double size = 30;
            double x = ActualWidth / 2 - size / 2 + _rng.Next(-60, 60);
            double baseY = ActualHeight - size - 20;
            var (tb, translate, _, _) = AddGlyph(glyph, size, x, baseY);

            var hop = new DoubleAnimationUsingKeyFrames();
            hop.KeyFrames.Add(new EasingDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
            hop.KeyFrames.Add(new EasingDoubleKeyFrame(-42, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(0.35)), new QuadraticEase { EasingMode = EasingMode.EaseOut }));
            hop.KeyFrames.Add(new EasingDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(0.7)), new QuadraticEase { EasingMode = EasingMode.EaseIn }));
            hop.KeyFrames.Add(new EasingDoubleKeyFrame(-28, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(1.0)), new QuadraticEase { EasingMode = EasingMode.EaseOut }));
            hop.KeyFrames.Add(new EasingDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(1.3)), new QuadraticEase { EasingMode = EasingMode.EaseIn }));
            hop.Completed += (_, _) => FadeOutRemove(tb, 0.5);
            translate.BeginAnimation(TranslateTransform.YProperty, hop);
            FadeIn(tb);
        }

        private void FloatUp(string glyph, double x, double delayMs)
        {
            double size = 24;
            double startY = ActualHeight - size - 20;
            var (tb, translate, rotate, _) = AddGlyph(glyph, size, x, startY);
            tb.Opacity = 0;

            var rise = new DoubleAnimation(0, -(ActualHeight * 0.5), TimeSpan.FromSeconds(2.4))
            { BeginTime = TimeSpan.FromMilliseconds(delayMs), EasingFunction = new SineEase { EasingMode = EasingMode.EaseOut } };
            translate.BeginAnimation(TranslateTransform.YProperty, rise);

            var op = new DoubleAnimationUsingKeyFrames { BeginTime = TimeSpan.FromMilliseconds(delayMs) };
            op.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)));
            op.KeyFrames.Add(new LinearDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(0.3))));
            op.KeyFrames.Add(new LinearDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(1.6))));
            op.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(2.4))));
            op.Completed += (_, _) => Stage.Children.Remove(tb);
            tb.BeginAnimation(UIElement.OpacityProperty, op);

            var wobble = new DoubleAnimation(-10, 10, TimeSpan.FromSeconds(0.5))
            { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, BeginTime = TimeSpan.FromMilliseconds(delayMs) };
            rotate.BeginAnimation(RotateTransform.AngleProperty, wobble);
        }

        // ----------------------------------------------------------------
        // Helpers
        // ----------------------------------------------------------------
        private (TextBlock, TranslateTransform, RotateTransform, ScaleTransform) AddGlyph(string glyph, double size, double left, double top)
        {
            var translate = new TranslateTransform();
            var rotate = new RotateTransform();
            var scale = new ScaleTransform();
            var grp = new TransformGroup();
            grp.Children.Add(scale);
            grp.Children.Add(rotate);
            grp.Children.Add(translate);

            var tb = new TextBlock
            {
                Text = glyph,
                FontSize = size,
                RenderTransformOrigin = new Point(0.5, 0.5),
                RenderTransform = grp
            };
            Canvas.SetLeft(tb, left);
            Canvas.SetTop(tb, top);
            Stage.Children.Add(tb);
            return (tb, translate, rotate, scale);
        }

        private static void FadeIn(UIElement el)
            => el.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromSeconds(0.35)));

        private void FadeOutRemove(UIElement el, double seconds)
        {
            var fade = new DoubleAnimation(el.Opacity, 0, TimeSpan.FromSeconds(seconds));
            fade.Completed += (_, _) => Stage.Children.Remove(el as UIElement);
            el.BeginAnimation(UIElement.OpacityProperty, fade);
        }

        private static string Trunc(string s)
        {
            s = (s ?? "").Trim();
            return s.Length > 60 ? s.Substring(0, 58) + "…" : s;
        }

        /// <summary>App-level brush lookup (DarkTheme is merged at the app level), with a safe fallback.</summary>
        private Brush Res(string key)
            => (TryFindResource(key) as Brush)
               ?? (Application.Current?.TryFindResource(key) as Brush)
               ?? Brushes.Gray;
    }
}

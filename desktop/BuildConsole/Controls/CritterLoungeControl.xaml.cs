using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace BuildConsole.Controls
{
    public enum CritterSceneType
    {
        BeachLounge = 0,
        DisneyMagicKingdom = 1,
        VelociCoaster = 2
    }

    /// <summary>
    /// Critter Lounge Multi-Scene Theater:
    /// 1. 🏖️ Ocean & Beach with Lounge Chairs, umbrella, tropical palm tree, and relaxing critters.
    /// 2. 🏰 Disney World Magic Kingdom with Cinderella's Castle, fireworks, Mickey ears, and pixie dust.
    /// 3. 🎢 Jurassic World VelociCoaster with high-speed drops, roaring raptors, and screaming critters.
    /// Features theatrical red velvet closing/opening curtains for seamless scene changes!
    /// </summary>
    public partial class CritterLoungeControl : UserControl
    {
        private static readonly Random Rng = new();

        private CritterSceneType _currentScene = CritterSceneType.BeachLounge;
        private readonly DispatcherTimer _sceneCycleTimer;
        private readonly DispatcherTimer _animationTickTimer;
        private bool _isTransitioning;
        private bool _isActionActive;

        // Active scene animation handles
        private readonly List<UIElement> _animatedElements = new();
        private FrameworkElement? _coasterTrain;
        private FrameworkElement? _raptorMascot;

        public CritterLoungeControl()
        {
            InitializeComponent();

            // Auto-cycle scenes every 48 seconds with theatrical curtains
            _sceneCycleTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(48) };
            _sceneCycleTimer.Tick += SceneCycleTimer_Tick;

            // Micro-animation timer for continuous ambient motion (waves, fireworks, coaster speed)
            _animationTickTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2.8) };
            _animationTickTimer.Tick += AnimationTickTimer_Tick;

            Loaded += CritterLoungeControl_Loaded;
            Unloaded += CritterLoungeControl_Unloaded;
        }

        private void CritterLoungeControl_Loaded(object sender, RoutedEventArgs e)
        {
            _sceneCycleTimer.Start();
            _animationTickTimer.Start();
            Dispatcher.BeginInvoke(new Action(() => RenderCurrentScene(animateCurtain: false)), DispatcherPriority.Background);
        }

        private void CritterLoungeControl_Unloaded(object sender, RoutedEventArgs e)
        {
            _sceneCycleTimer.Stop();
            _animationTickTimer.Stop();
            ClearAllCanvases();
        }

        private void SceneCycleTimer_Tick(object? sender, EventArgs e)
        {
            if (_isTransitioning) return;
            var next = (CritterSceneType)(((int)_currentScene + 1) % 3);
            TransitionToScene(next);
        }

        private void AnimationTickTimer_Tick(object? sender, EventArgs e)
        {
            if (_isTransitioning) return;

            switch (_currentScene)
            {
                case CritterSceneType.DisneyMagicKingdom:
                    SpawnDisneyFirework();
                    break;
                case CritterSceneType.VelociCoaster:
                    PulseVelociCoasterAction();
                    break;
                case CritterSceneType.BeachLounge:
                    SpawnBeachSunGlint();
                    break;
            }
        }

        private void Lounge_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            TriggerSceneAction();
            SpawnClickSparkles(e.GetPosition(LoungeCanvas));
        }

        private void SceneBadge_Click(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
            if (_isTransitioning) return;
            var next = (CritterSceneType)(((int)_currentScene + 1) % 3);
            TransitionToScene(next);
        }

        private void BtnNextScene_Click(object sender, RoutedEventArgs e)
        {
            if (_isTransitioning) return;
            var next = (CritterSceneType)(((int)_currentScene + 1) % 3);
            TransitionToScene(next);
        }

        private void BtnCheer_Click(object sender, RoutedEventArgs e)
        {
            TriggerSceneAction();
            SpawnCheerBurst();
        }

        // ══════════════════════════════════════════════════════════════════════
        // THEATRICAL CURTAIN TRANSITION SYSTEM
        // ══════════════════════════════════════════════════════════════════════
        public void TransitionToScene(CritterSceneType nextScene)
        {
            if (_isTransitioning) return;
            _isTransitioning = true;

            double stageW = ActualWidth > 50 ? ActualWidth : 340.0;
            double halfW = Math.Ceiling(stageW / 2.0) + 6.0;

            // 1. Curtains Slide Closed (Left & Right towards center)
            var closeAnimLeft = new DoubleAnimation(0, halfW, TimeSpan.FromMilliseconds(420))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut }
            };
            var closeAnimRight = new DoubleAnimation(0, halfW, TimeSpan.FromMilliseconds(420))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut }
            };

            closeAnimLeft.Completed += (_, _) =>
            {
                // 2. Curtains fully closed: Swap scene data & rebuild canvas
                _currentScene = nextScene;
                RenderCurrentScene(animateCurtain: false);

                // Small dramatic theater pause, then curtains open
                var openTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(180) };
                openTimer.Tick += (_, _) =>
                {
                    openTimer.Stop();

                    var openAnimLeft = new DoubleAnimation(halfW, 0, TimeSpan.FromMilliseconds(480))
                    {
                        EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                    };
                    var openAnimRight = new DoubleAnimation(halfW, 0, TimeSpan.FromMilliseconds(480))
                    {
                        EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                    };

                    openAnimLeft.Completed += (_, _) =>
                    {
                        _isTransitioning = false;
                        TriggerSceneAction();
                    };

                    LeftCurtain.BeginAnimation(WidthProperty, openAnimLeft);
                    RightCurtain.BeginAnimation(WidthProperty, openAnimRight);
                };
                openTimer.Start();
            };

            LeftCurtain.BeginAnimation(WidthProperty, closeAnimLeft);
            RightCurtain.BeginAnimation(WidthProperty, closeAnimRight);
        }

        private void ClearAllCanvases()
        {
            BackgroundCanvas.Children.Clear();
            LoungeCanvas.Children.Clear();
            FxCanvas.Children.Clear();
            _animatedElements.Clear();
            _coasterTrain = null;
            _raptorMascot = null;
            _castleSparkler = null;
        }

        private void RenderCurrentScene(bool animateCurtain)
        {
            ClearAllCanvases();

            switch (_currentScene)
            {
                case CritterSceneType.BeachLounge:
                    BuildBeachLoungeScene();
                    break;
                case CritterSceneType.DisneyMagicKingdom:
                    BuildDisneyMagicKingdomScene();
                    break;
                case CritterSceneType.VelociCoaster:
                    BuildVelociCoasterScene();
                    break;
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENE 1: 🏖️ OCEAN & BEACH WITH LOUNGE CHAIR
        // ══════════════════════════════════════════════════════════════════════
        private void BuildBeachLoungeScene()
        {
            SceneIcon.Text = "🏖️ ";
            SceneTitleText.Text = "SUNNY BEACH LOUNGE";
            SceneSubText.Text = " · chilling 🍹";
            CheerBtnIcon.Text = "🍹";
            SceneBadge.BorderBrush = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8)); // Sky Blue

            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            // 1. Sky & Ocean Background
            var skyRect = new Rectangle
            {
                Width = w + 40,
                Height = h,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x38, 0xBD, 0xF8), // Sky Blue
                    Color.FromRgb(0xBA, 0xE6, 0xFD), // Light Blue
                    new Point(0, 0),
                    new Point(0, 0.7))
            };
            BackgroundCanvas.Children.Add(skyRect);

            // Sun with golden glow
            var sun = new Ellipse
            {
                Width = 42,
                Height = 42,
                Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)),
                Effect = new DropShadowEffect
                {
                    Color = Color.FromRgb(0xF5, 0x9E, 0x0B),
                    BlurRadius = 24,
                    ShadowDepth = 0,
                    Opacity = 0.8
                }
            };
            Canvas.SetLeft(sun, w - 85);
            Canvas.SetTop(sun, 14);
            BackgroundCanvas.Children.Add(sun);

            // Clouds
            var cloud1 = CreateVectorCloud(60, 24);
            Canvas.SetLeft(cloud1, 25);
            Canvas.SetTop(cloud1, 18);
            BackgroundCanvas.Children.Add(cloud1);

            // 2. Turquoise Ocean Water Waves
            var oceanGeom = Geometry.Parse($"M 0,{h * 0.55} C {w * 0.3},{h * 0.52} {w * 0.7},{h * 0.58} {w + 20},{h * 0.54} L {w + 20},{h} L 0,{h} Z");
            var oceanPath = new Path
            {
                Data = oceanGeom,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x06, 0xB6, 0xD4), // Cyan
                    Color.FromRgb(0x02, 0x84, 0xC7), // Ocean Blue
                    new Point(0, 0),
                    new Point(0, 1))
            };
            BackgroundCanvas.Children.Add(oceanPath);

            // Animated wave ripple
            var waveLine = new Path
            {
                Data = Geometry.Parse($"M 0,{h * 0.56} C {w * 0.25},{h * 0.53} {w * 0.65},{h * 0.59} {w},{h * 0.55}"),
                Stroke = new SolidColorBrush(Color.FromArgb(160, 255, 255, 255)),
                StrokeThickness = 2.5,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round
            };
            var waveAnim = new DoubleAnimation(-3, 3, TimeSpan.FromSeconds(1.4))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            var waveTrans = new TranslateTransform();
            waveLine.RenderTransform = waveTrans;
            waveTrans.BeginAnimation(TranslateTransform.YProperty, waveAnim);
            BackgroundCanvas.Children.Add(waveLine);

            // 3. Sandy Shore
            var sandGeom = Geometry.Parse($"M 0,{h * 0.68} C {w * 0.4},{h * 0.64} {w * 0.8},{h * 0.72} {w + 20},{h * 0.67} L {w + 20},{h} L 0,{h} Z");
            var sandPath = new Path
            {
                Data = sandGeom,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xFE, 0xF0, 0x8A), // Warm Yellow Sand
                    Color.FromRgb(0xCA, 0x8A, 0x04), // Golden Amber Sand
                    new Point(0, 0),
                    new Point(0, 1))
            };
            BackgroundCanvas.Children.Add(sandPath);

            // 4. Palm Tree on Left Shore
            var palmTree = CreateVectorPalmTree(h * 0.85);
            Canvas.SetLeft(palmTree, 10);
            Canvas.SetTop(palmTree, h * 0.18);
            LoungeCanvas.Children.Add(palmTree);

            // 5. Wooden Lounge Chair with Striped Umbrella
            var loungeChair = CreateVectorLoungeChair();
            Canvas.SetLeft(loungeChair, w * 0.36);
            Canvas.SetTop(loungeChair, h * 0.60);
            LoungeCanvas.Children.Add(loungeChair);

            // 6. Sunbathing Otter on Lounge Chair wearing sunglasses
            var sunbather = CreateSunbathingOtter();
            Canvas.SetLeft(sunbather, w * 0.38);
            Canvas.SetTop(sunbather, h * 0.54);
            LoungeCanvas.Children.Add(sunbather);

            // 7. Sailor Duck Donald relaxing by the water with lemonade
            var donaldBeach = SailorDuckMascotLayer.CreateSailorDuckInSailboat(75, 75, showSpeechBubble: false);
            Canvas.SetLeft(donaldBeach, w * 0.72);
            Canvas.SetTop(donaldBeach, h * 0.44);

            var donaldBob = new TranslateTransform();
            donaldBeach.RenderTransform = donaldBob;
            var donaldBobAnim = new DoubleAnimation(-4, 4, TimeSpan.FromSeconds(1.1))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            donaldBob.BeginAnimation(TranslateTransform.YProperty, donaldBobAnim);
            LoungeCanvas.Children.Add(donaldBeach);

            // 8. Cute Scuttling Beach Crab
            var crab = CreateVectorCrab();
            Canvas.SetLeft(crab, w * 0.22);
            Canvas.SetTop(crab, h * 0.78);
            LoungeCanvas.Children.Add(crab);
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENE 2: 🏰 DISNEY WORLD MAGIC KINGDOM (SHANE'S FAVORITE PLACE!)
        // ══════════════════════════════════════════════════════════════════════
        private void BuildDisneyMagicKingdomScene()
        {
            SceneIcon.Text = "🏰 ";
            SceneTitleText.Text = "MAGIC KINGDOM";
            SceneSubText.Text = " · Disney Cheer ✨";
            CheerBtnIcon.Text = "✨";
            SceneBadge.BorderBrush = new SolidColorBrush(Color.FromRgb(0xF5, 0x9E, 0x0B)); // Gold

            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            // 1. Royal Twilight Indigo Sky
            var skyRect = new Rectangle
            {
                Width = w + 40,
                Height = h,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x0A, 0x0A, 0x1E), // Midnight Navy
                    Color.FromRgb(0x1E, 0x1B, 0x4B), // Royal Indigo
                    new Point(0, 0),
                    new Point(0, 1))
            };
            BackgroundCanvas.Children.Add(skyRect);

            // Ambient Twinkling Stars
            for (int i = 0; i < 18; i++)
            {
                var star = new Ellipse
                {
                    Width = Rng.Next(2, 4),
                    Height = Rng.Next(2, 4),
                    Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A))
                };
                Canvas.SetLeft(star, Rng.Next(10, (int)w - 10));
                Canvas.SetTop(star, Rng.Next(8, (int)(h * 0.6)));
                BackgroundCanvas.Children.Add(star);
            }

            // 2. Cinderella's Castle Vector Silhouette & Glowing Spires
            var castle = CreateCinderellaCastle(w, h);
            Canvas.SetLeft(castle, (w - 220) / 2.0);
            Canvas.SetTop(castle, h * 0.15);
            BackgroundCanvas.Children.Add(castle);

            // Castle Courtyard Ground
            var ground = new Rectangle
            {
                Width = w + 40,
                Height = h * 0.22,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x1E, 0x1E, 0x2E),
                    Color.FromRgb(0x11, 0x11, 0x1B),
                    new Point(0, 0),
                    new Point(0, 1))
            };
            Canvas.SetTop(ground, h * 0.78);
            BackgroundCanvas.Children.Add(ground);

            // 3. Disney Cheer Mascots:
            // A. Wizard Sorcerer Mickey Mouse Critter casting sparks!
            var wizardMickey = CreateSorcererMickeyCritter();
            Canvas.SetLeft(wizardMickey, w * 0.18);
            Canvas.SetTop(wizardMickey, h * 0.58);
            LoungeCanvas.Children.Add(wizardMickey);

            // B. Cheerful Critter wearing Mickey Ears Headband
            var earsCritter = CreateMickeyEarsBunny();
            Canvas.SetLeft(earsCritter, w * 0.50);
            Canvas.SetTop(earsCritter, h * 0.60);
            LoungeCanvas.Children.Add(earsCritter);

            // C. Donald Duck in Royal Cape waving happily
            var donaldRoyal = SailorDuckMascotLayer.CreateSailorDuckInSailboat(80, 80, showSpeechBubble: true, speechText: "Dreams come true! ✨");
            Canvas.SetLeft(donaldRoyal, w * 0.68);
            Canvas.SetTop(donaldRoyal, h * 0.48);
            LoungeCanvas.Children.Add(donaldRoyal);

            // Initial Firework Burst
            SpawnDisneyFirework();
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENE 3: 🎢 VELOCICOASTER (SHANE'S FAVORITE ROLLER COASTER!)
        // ══════════════════════════════════════════════════════════════════════
        private void BuildVelociCoasterScene()
        {
            SceneIcon.Text = "🎢 ";
            SceneTitleText.Text = "VELOCICOASTER";
            SceneSubText.Text = " · 80 MPH & Raptors 🦖";
            CheerBtnIcon.Text = "⚡";
            SceneBadge.BorderBrush = new SolidColorBrush(Color.FromRgb(0x06, 0xB6, 0xD4)); // Cyan Neon

            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            // 1. Jurassic Night Sky & Electric Neon Atmosphere
            var skyRect = new Rectangle
            {
                Width = w + 40,
                Height = h,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x06, 0x10, 0x18), // Dark Jurassic Blue/Black
                    Color.FromRgb(0x0D, 0x22, 0x2F), // Electric Teal Dark
                    new Point(0, 0),
                    new Point(0, 1))
            };
            BackgroundCanvas.Children.Add(skyRect);

            // Paddock Steel Fencing & High-Voltage Warning Grid
            var paddockFence = CreatePaddockFence(w, h);
            BackgroundCanvas.Children.Add(paddockFence);

            // 2. High-Speed VelociCoaster Track with 80° Top Hat Drop Loop
            var trackCanvas = CreateVelociCoasterTrack(w, h);
            BackgroundCanvas.Children.Add(trackCanvas);

            // 3. High-Speed Coaster Train with Screaming Critters (Paws in the air!)
            var train = CreateVelociCoasterTrain();
            _coasterTrain = train;
            Canvas.SetLeft(train, -100);
            Canvas.SetTop(train, h * 0.35);
            LoungeCanvas.Children.Add(train);

            // Animate Coaster Train Zooming Across Track
            LaunchCoasterTrainAnimation(train, w, h);

            // 4. VelociCoaster Raptor (Blue/Delta) with glowing blue racing stripe
            var raptor = CreateVelociRaptor();
            _raptorMascot = raptor;
            Canvas.SetLeft(raptor, w * 0.66);
            Canvas.SetTop(raptor, h * 0.60);
            LoungeCanvas.Children.Add(raptor);

            // 5. Coaster Warning Badge & Speed Meter
            var speedBadge = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(200, 10, 20, 30)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x06, 0xB6, 0xD4)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(6, 2, 6, 2)
            };
            var speedText = new TextBlock
            {
                Text = "⚡ 80 MPH · 4 INVERSIONS",
                FontSize = 8.5,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8))
            };
            speedBadge.Child = speedText;
            Canvas.SetLeft(speedBadge, 12);
            Canvas.SetTop(speedBadge, h * 0.78);
            LoungeCanvas.Children.Add(speedBadge);
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENE INTERACTION & CHEER TRIGGERS
        // ══════════════════════════════════════════════════════════════════════
        public void TriggerSceneAction()
        {
            switch (_currentScene)
            {
                case CritterSceneType.BeachLounge:
                    // Splash wave burst & sunshine sparkle
                    SpawnBeachSunGlint();
                    SpawnClickSparkles(new Point(ActualWidth * 0.5, 90));
                    break;
                case CritterSceneType.DisneyMagicKingdom:
                    // Spectacular multi-color Disney Fireworks & Pixie Dust!
                    for (int i = 0; i < 4; i++)
                    {
                        var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(i * 180) };
                        t.Tick += (_, _) => { t.Stop(); SpawnDisneyFirework(); };
                        t.Start();
                    }
                    break;
                case CritterSceneType.VelociCoaster:
                    // Coaster turbo boost & raptor roar!
                    if (_coasterTrain != null)
                    {
                        LaunchCoasterTrainAnimation(_coasterTrain, ActualWidth, ActualHeight);
                    }
                    if (_raptorMascot != null)
                    {
                        PlayRaptorRoar(_raptorMascot);
                    }
                    break;
            }
        }

        private void SpawnCheerBurst()
        {
            double cx = ActualWidth > 0 ? ActualWidth / 2.0 : 180.0;
            double cy = ActualHeight > 0 ? ActualHeight * 0.5 : 80.0;

            Color[] colors =
            {
                Color.FromRgb(0xFA, 0xB3, 0x87), // Peach
                Color.FromRgb(0x89, 0xB4, 0xFA), // Blue
                Color.FromRgb(0xA6, 0xE3, 0xA1), // Green
                Color.FromRgb(0xF9, 0xE2, 0xAF), // Yellow
                Color.FromRgb(0xF3, 0x8B, 0xA8)  // Red
            };

            for (int i = 0; i < 22; i++)
            {
                var dot = new Ellipse
                {
                    Width = 6 + Rng.Next(0, 4),
                    Height = 6 + Rng.Next(0, 4),
                    Fill = new SolidColorBrush(colors[Rng.Next(colors.Length)])
                };
                Canvas.SetLeft(dot, cx);
                Canvas.SetTop(dot, cy);
                FxCanvas.Children.Add(dot);

                double angle = Rng.NextDouble() * Math.PI * 2;
                double dist = Rng.Next(30, 90);
                double tx = cx + Math.Cos(angle) * dist;
                double ty = cy + Math.Sin(angle) * dist;

                var xAnim = new DoubleAnimation(cx, tx, TimeSpan.FromSeconds(0.8)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
                var yAnim = new DoubleAnimation(cy, ty, TimeSpan.FromSeconds(0.8)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
                var fade = new DoubleAnimation(1.0, 0.0, TimeSpan.FromSeconds(0.8));

                xAnim.Completed += (_, _) => FxCanvas.Children.Remove(dot);

                dot.BeginAnimation(Canvas.LeftProperty, xAnim);
                dot.BeginAnimation(Canvas.TopProperty, yAnim);
                dot.BeginAnimation(OpacityProperty, fade);
            }
        }

        private void SpawnClickSparkles(Point pt)
        {
            string[] icons = { "✨", "⭐", "💖", "🎉", "🦖", "🏰", "🌊" };
            for (int i = 0; i < 5; i++)
            {
                var tb = new TextBlock
                {
                    Text = icons[Rng.Next(icons.Length)],
                    FontSize = 13 + Rng.Next(0, 5)
                };
                Canvas.SetLeft(tb, pt.X + Rng.Next(-20, 20));
                Canvas.SetTop(tb, pt.Y + Rng.Next(-15, 15));
                FxCanvas.Children.Add(tb);

                var yAnim = new DoubleAnimation(Canvas.GetTop(tb), Canvas.GetTop(tb) - 35 - Rng.Next(0, 20), TimeSpan.FromSeconds(0.9))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                };
                var fade = new DoubleAnimation(1.0, 0.0, TimeSpan.FromSeconds(0.9));
                yAnim.Completed += (_, _) => FxCanvas.Children.Remove(tb);

                tb.BeginAnimation(Canvas.TopProperty, yAnim);
                tb.BeginAnimation(OpacityProperty, fade);
            }
        }

        private void SpawnDisneyFirework()
        {
            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            double fx = Rng.Next(30, (int)w - 30);
            double fy = Rng.Next(20, (int)(h * 0.45));

            Color[] fwColors =
            {
                Color.FromRgb(0xFE, 0xF0, 0x8A), // Gold Sparkle
                Color.FromRgb(0xF4, 0x72, 0xB6), // Disney Pink
                Color.FromRgb(0x60, 0xA5, 0xFA), // Royal Blue
                Color.FromRgb(0xA7, 0x8B, 0xFA), // Magic Violet
                Color.FromRgb(0x34, 0xD3, 0x99)  // Emerald
            };
            var color = fwColors[Rng.Next(fwColors.Length)];

            // Central glow burst
            var glow = new Ellipse
            {
                Width = 24,
                Height = 24,
                Fill = new SolidColorBrush(color),
                Opacity = 0.9,
                Effect = new DropShadowEffect { Color = color, BlurRadius = 18, ShadowDepth = 0 }
            };
            Canvas.SetLeft(glow, fx - 12);
            Canvas.SetTop(glow, fy - 12);
            FxCanvas.Children.Add(glow);

            var glowAnim = new DoubleAnimation(0.9, 0.0, TimeSpan.FromSeconds(0.8));
            glowAnim.Completed += (_, _) => FxCanvas.Children.Remove(glow);
            glow.BeginAnimation(OpacityProperty, glowAnim);

            // Radiant sparkle sparks
            for (int i = 0; i < 14; i++)
            {
                var spark = new Ellipse
                {
                    Width = 4,
                    Height = 4,
                    Fill = new SolidColorBrush(color)
                };
                Canvas.SetLeft(spark, fx);
                Canvas.SetTop(spark, fy);
                FxCanvas.Children.Add(spark);

                double angle = (i / 14.0) * Math.PI * 2;
                double dist = Rng.Next(22, 50);
                double tx = fx + Math.Cos(angle) * dist;
                double ty = fy + Math.Sin(angle) * dist;

                var xAnim = new DoubleAnimation(fx, tx, TimeSpan.FromSeconds(0.85)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } };
                var yAnim = new DoubleAnimation(fy, ty + 10, TimeSpan.FromSeconds(0.85)) { EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn } };
                var fade = new DoubleAnimation(1.0, 0.0, TimeSpan.FromSeconds(0.85));

                xAnim.Completed += (_, _) => FxCanvas.Children.Remove(spark);

                spark.BeginAnimation(Canvas.LeftProperty, xAnim);
                spark.BeginAnimation(Canvas.TopProperty, yAnim);
                spark.BeginAnimation(OpacityProperty, fade);
            }
        }

        private void SpawnBeachSunGlint()
        {
            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            for (int i = 0; i < 4; i++)
            {
                var glint = new TextBlock
                {
                    Text = "✨",
                    FontSize = 10 + Rng.Next(0, 4),
                    Foreground = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A))
                };
                Canvas.SetLeft(glint, Rng.Next((int)(w * 0.3), (int)w - 20));
                Canvas.SetTop(glint, Rng.Next((int)(h * 0.52), (int)(h * 0.68)));
                FxCanvas.Children.Add(glint);

                var fade = new DoubleAnimation(1.0, 0.0, TimeSpan.FromSeconds(1.2));
                fade.Completed += (_, _) => FxCanvas.Children.Remove(glint);
                glint.BeginAnimation(OpacityProperty, fade);
            }
        }

        private void PulseVelociCoasterAction()
        {
            if (_coasterTrain != null && !_isActionActive)
            {
                LaunchCoasterTrainAnimation(_coasterTrain, ActualWidth, ActualHeight);
            }
            if (_raptorMascot != null)
            {
                PlayRaptorRoar(_raptorMascot);
            }
        }

        private void LaunchCoasterTrainAnimation(FrameworkElement train, double stageW, double stageH)
        {
            _isActionActive = true;
            double w = stageW > 50 ? stageW : 360;
            double h = stageH > 50 ? stageH : 172;

            // Coaster zoom path across screen
            var xAnim = new DoubleAnimation(-120, w + 120, TimeSpan.FromSeconds(1.8))
            {
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };

            // Drop and rise Y animation
            var yAnim = new DoubleAnimation(h * 0.35, h * 0.55, TimeSpan.FromSeconds(0.9))
            {
                AutoReverse = true,
                EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
            };

            // Banking / tilting rotation
            var rot = new RotateTransform(0, 60, 20);
            train.RenderTransform = rot;
            var tiltAnim = new DoubleAnimation(-15, 20, TimeSpan.FromSeconds(0.9))
            {
                AutoReverse = true,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            rot.BeginAnimation(RotateTransform.AngleProperty, tiltAnim);

            xAnim.Completed += (_, _) =>
            {
                _isActionActive = false;
                Canvas.SetLeft(train, -140);
            };

            train.BeginAnimation(Canvas.LeftProperty, xAnim);
            train.BeginAnimation(Canvas.TopProperty, yAnim);

            // Spawn electric cyan sparks behind the wheels
            for (int i = 0; i < 8; i++)
            {
                var spark = new Ellipse
                {
                    Width = 3,
                    Height = 3,
                    Fill = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8))
                };
                Canvas.SetLeft(spark, Rng.Next(40, (int)w - 40));
                Canvas.SetTop(spark, h * 0.48 + Rng.Next(-10, 10));
                FxCanvas.Children.Add(spark);

                var fade = new DoubleAnimation(1.0, 0.0, TimeSpan.FromSeconds(0.6));
                fade.Completed += (_, _) => FxCanvas.Children.Remove(spark);
                spark.BeginAnimation(OpacityProperty, fade);
            }
        }

        private void PlayRaptorRoar(FrameworkElement raptor)
        {
            if (raptor.RenderTransform is TransformGroup tg)
            {
                var scale = tg.Children.Count > 0 && tg.Children[0] is ScaleTransform st ? st : new ScaleTransform(1, 1);
                var roarAnim = new DoubleAnimation(1.0, 1.25, TimeSpan.FromMilliseconds(200))
                {
                    AutoReverse = true,
                    RepeatBehavior = new RepeatBehavior(2),
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                };
                scale.BeginAnimation(ScaleTransform.ScaleXProperty, roarAnim);
                scale.BeginAnimation(ScaleTransform.ScaleYProperty, roarAnim);
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        // VECTOR ART BUILDERS (PALM TREE, CINDERELLA CASTLE, VELOCICOASTER)
        // ══════════════════════════════════════════════════════════════════════

        private static Canvas CreateVectorCloud(double width, double height)
        {
            var canvas = new Canvas { Width = width, Height = height };
            var geom = Geometry.Parse("M 10,20 C 5,20 0,16 0,10 C 0,5 5,0 12,0 C 18,0 24,4 26,8 C 30,5 38,5 42,9 C 48,9 54,14 54,20 Z");
            var path = new Path
            {
                Data = geom,
                Fill = new SolidColorBrush(Color.FromArgb(200, 255, 255, 255))
            };
            canvas.Children.Add(path);
            return canvas;
        }

        private static Canvas CreateVectorPalmTree(double height)
        {
            var canvas = new Canvas { Width = 75, Height = height };

            // Curved segmented trunk
            var trunkGeom = Geometry.Parse("M 36,95 C 38,60 28,30 32,10 C 35,10 42,30 40,60 C 39,75 42,95 42,95 Z");
            var trunkPath = new Path
            {
                Data = trunkGeom,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x92, 0x40, 0x0E), // Amber-Brown
                    Color.FromRgb(0x78, 0x35, 0x0F),
                    new Point(0, 0),
                    new Point(1, 0))
            };
            canvas.Children.Add(trunkPath);

            // Coconut cluster
            var coco1 = new Ellipse { Width = 7, Height = 7, Fill = new SolidColorBrush(Color.FromRgb(0x45, 0x1A, 0x03)) };
            Canvas.SetLeft(coco1, 30); Canvas.SetTop(coco1, 11);
            var coco2 = new Ellipse { Width = 7, Height = 7, Fill = new SolidColorBrush(Color.FromRgb(0x45, 0x1A, 0x03)) };
            Canvas.SetLeft(coco2, 35); Canvas.SetTop(coco2, 13);
            canvas.Children.Add(coco1);
            canvas.Children.Add(coco2);

            // Lush Palm Fronds
            string[] frondPaths =
            {
                "M 33,10 C 20,4 5,8 0,22 C 8,18 20,16 33,10 Z",
                "M 33,10 C 15,-2 -5,-2 -15,10 C -5,4 15,4 33,10 Z",
                "M 33,10 C 35,-6 45,-10 60,-4 C 50,0 42,4 33,10 Z",
                "M 33,10 C 45,-2 60,6 68,20 C 58,14 45,12 33,10 Z"
            };

            foreach (var fp in frondPaths)
            {
                var frond = new Path
                {
                    Data = Geometry.Parse(fp),
                    Fill = new SolidColorBrush(Color.FromRgb(0x16, 0xA3, 0x4A)),
                    Stroke = new SolidColorBrush(Color.FromRgb(0x15, 0x80, 0x3D)),
                    StrokeThickness = 0.8
                };
                canvas.Children.Add(frond);
            }

            return canvas;
        }

        private static Canvas CreateVectorLoungeChair()
        {
            var canvas = new Canvas { Width = 65, Height = 45 };

            // Striped Beach Umbrella
            var umbrellaPole = new Rectangle { Width = 2.5, Height = 36, Fill = new SolidColorBrush(Color.FromRgb(0xDE, 0xE2, 0xE6)) };
            Canvas.SetLeft(umbrellaPole, 14); Canvas.SetTop(umbrellaPole, 2);
            canvas.Children.Add(umbrellaPole);

            var umbrellaCanopy = new Path
            {
                Data = Geometry.Parse("M 0,12 C 4,2 24,2 28,12 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xEF, 0x44, 0x44), // Red/White striped look
                    Color.FromRgb(0xFA, 0xFA, 0xFA),
                    new Point(0, 0),
                    new Point(1, 0)),
                Stroke = new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26)),
                StrokeThickness = 1.0
            };
            canvas.Children.Add(umbrellaCanopy);

            // Wooden Reclining Lounge Chair
            var chairBase = new Path
            {
                Data = Geometry.Parse("M 18,34 L 54,34 L 62,24 L 60,22 L 52,32 L 20,32 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0xD9, 0x77, 0x06)) // Amber Wood
            };
            canvas.Children.Add(chairBase);

            // Cushion Mattress (Cyan Blue)
            var cushion = new Path
            {
                Data = Geometry.Parse("M 20,31 L 52,31 L 60,22 L 59,20 L 51,29 L 20,29 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x06, 0xB6, 0xD4))
            };
            canvas.Children.Add(cushion);

            // Cold Drink with Straw
            var drink = new TextBlock { Text = "🍹", FontSize = 12 };
            Canvas.SetLeft(drink, 4); Canvas.SetTop(drink, 24);
            canvas.Children.Add(drink);

            return canvas;
        }

        private static Canvas CreateSunbathingOtter()
        {
            var canvas = new Canvas { Width = 38, Height = 28 };

            // Otter Body reclining
            var body = new Ellipse
            {
                Width = 24,
                Height = 12,
                Fill = new SolidColorBrush(Color.FromRgb(0x8D, 0x5B, 0x4C))
            };
            Canvas.SetLeft(body, 8); Canvas.SetTop(body, 8);
            canvas.Children.Add(body);

            // Otter Head
            var head = new Ellipse
            {
                Width = 14,
                Height = 12,
                Fill = new SolidColorBrush(Color.FromRgb(0x9E, 0x6B, 0x5C))
            };
            Canvas.SetLeft(head, 22); Canvas.SetTop(head, 4);
            canvas.Children.Add(head);

            // Sunglasses 😎
            var glasses = new Path
            {
                Data = Geometry.Parse("M 24,7 L 34,7 L 33,10 L 29,10 L 28,8 L 25,10 L 23,8 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B))
            };
            canvas.Children.Add(glasses);

            return canvas;
        }

        private static Canvas CreateVectorCrab()
        {
            var canvas = new Canvas { Width = 22, Height = 18 };
            var crabEmoji = new TextBlock { Text = "🦀", FontSize = 14 };
            canvas.Children.Add(crabEmoji);

            // Claw scuttle wiggle
            var trans = new TranslateTransform();
            canvas.RenderTransform = trans;
            var wiggle = new DoubleAnimation(-2, 2, TimeSpan.FromMilliseconds(400))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever
            };
            trans.BeginAnimation(TranslateTransform.XProperty, wiggle);
            return canvas;
        }

        // ── CINDERELLA CASTLE VECTOR ART (DISNEY MAGIC KINGDOM) ──
        private static Canvas CreateCinderellaCastle(double stageW, double stageH)
        {
            var canvas = new Canvas { Width = 220, Height = 120 };

            // Main Stone Facade Base
            var baseWall = new Path
            {
                Data = Geometry.Parse("M 40,110 L 40,55 L 75,55 L 75,38 L 145,38 L 145,55 L 180,55 L 180,110 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x94, 0xA3, 0xB8), // Soft Castle Slate Stone
                    Color.FromRgb(0x64, 0x74, 0x8B),
                    new Point(0, 0),
                    new Point(0, 1)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55)),
                StrokeThickness = 1.0
            };
            canvas.Children.Add(baseWall);

            // Arched Castle Gate (Illuminated Gold)
            var gate = new Path
            {
                Data = Geometry.Parse("M 96,110 L 96,82 C 96,74 124,74 124,82 L 124,110 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)), // Warm Light
                Effect = new DropShadowEffect { Color = Color.FromRgb(0xF5, 0x9E, 0x0B), BlurRadius = 12, ShadowDepth = 0 }
            };
            canvas.Children.Add(gate);

            // Castle Spires & Conical Royal Blue Roofs with Gold Finials
            // Left Spire
            var leftRoof = new Path
            {
                Data = Geometry.Parse("M 38,55 L 49,18 L 60,55 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8)) // Royal Disney Blue
            };
            canvas.Children.Add(leftRoof);
            var leftFinial = new Ellipse { Width = 4, Height = 4, Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)) };
            Canvas.SetLeft(leftFinial, 47); Canvas.SetTop(leftFinial, 16);
            canvas.Children.Add(leftFinial);

            // Right Spire
            var rightRoof = new Path
            {
                Data = Geometry.Parse("M 160,55 L 171,18 L 182,55 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8))
            };
            canvas.Children.Add(rightRoof);
            var rightFinial = new Ellipse { Width = 4, Height = 4, Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)) };
            Canvas.SetLeft(rightFinial, 169); Canvas.SetTop(rightFinial, 16);
            canvas.Children.Add(rightFinial);

            // Majestic Central Tower (TALLEST SPIRE)
            var centerTower = new Rectangle
            {
                Width = 40,
                Height = 36,
                Fill = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8))
            };
            Canvas.SetLeft(centerTower, 90); Canvas.SetTop(centerTower, 18);
            canvas.Children.Add(centerTower);

            var centerRoof = new Path
            {
                Data = Geometry.Parse("M 86,20 L 110,-12 L 134,20 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x25, 0x63, 0xEB), // Vivid Royal Blue
                    Color.FromRgb(0x1E, 0x3A, 0x8A),
                    new Point(0, 0),
                    new Point(0, 1))
            };
            canvas.Children.Add(centerRoof);

            // Golden Clock Face on Central Tower
            var clock = new Ellipse
            {
                Width = 10,
                Height = 10,
                Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)),
                Stroke = new SolidColorBrush(Color.FromRgb(0xB4, 0x53, 0x09)),
                StrokeThickness = 1.0
            };
            Canvas.SetLeft(clock, 105); Canvas.SetTop(clock, 24);
            canvas.Children.Add(clock);

            // Glowing Golden Castle Windows
            double[][] windowCoords = new double[][]
            {
                new double[] { 50, 72 },
                new double[] { 160, 72 },
                new double[] { 105, 42 }
            };
            foreach (var wc in windowCoords)
            {
                var win = new Rectangle
                {
                    Width = 6,
                    Height = 9,
                    RadiusX = 3,
                    RadiusY = 3,
                    Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A))
                };
                Canvas.SetLeft(win, wc[0]); Canvas.SetTop(win, wc[1]);
                canvas.Children.Add(win);
            }

            return canvas;
        }

        private static Canvas CreateSorcererMickeyCritter()
        {
            var canvas = new Canvas { Width = 45, Height = 48 };

            // Mouse Body (Red Robe)
            var robe = new Path
            {
                Data = Geometry.Parse("M 15,22 L 30,22 L 34,44 L 11,44 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26)) // Sorcerer Red
            };
            canvas.Children.Add(robe);

            // Mouse Head
            var head = new Ellipse
            {
                Width = 18,
                Height = 18,
                Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B))
            };
            Canvas.SetLeft(head, 13.5); Canvas.SetTop(head, 8);
            canvas.Children.Add(head);

            // Mickey Ears
            var earL = new Ellipse { Width = 11, Height = 11, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(earL, 7); Canvas.SetTop(earL, 2);
            var earR = new Ellipse { Width = 11, Height = 11, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(earR, 27); Canvas.SetTop(earR, 2);
            canvas.Children.Add(earL);
            canvas.Children.Add(earR);

            // Sorcerer Hat (Blue with Gold Moon & Stars)
            var hat = new Path
            {
                Data = Geometry.Parse("M 14,9 L 22.5,-6 L 31,9 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8))
            };
            canvas.Children.Add(hat);
            var star = new TextBlock { Text = "⭐", FontSize = 7 };
            Canvas.SetLeft(star, 19); Canvas.SetTop(star, -1);
            canvas.Children.Add(star);

            // Magic Wand with Sparkle Loop
            var wand = new TextBlock { Text = "🪄", FontSize = 12 };
            Canvas.SetLeft(wand, 26); Canvas.SetTop(wand, 20);
            canvas.Children.Add(wand);

            return canvas;
        }

        private static Canvas CreateMickeyEarsBunny()
        {
            var canvas = new Canvas { Width = 38, Height = 40 };

            // Bunny Body
            var body = new Ellipse { Width = 20, Height = 22, Fill = new SolidColorBrush(Color.FromRgb(0xFA, 0xFA, 0xFA)) };
            Canvas.SetLeft(body, 9); Canvas.SetTop(body, 16);
            canvas.Children.Add(body);

            // Head
            var head = new Ellipse { Width = 16, Height = 16, Fill = new SolidColorBrush(Color.FromRgb(0xFA, 0xFA, 0xFA)) };
            Canvas.SetLeft(head, 11); Canvas.SetTop(head, 6);
            canvas.Children.Add(head);

            // Mickey Mouse Ears Headband
            var earL = new Ellipse { Width = 9, Height = 9, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(earL, 6); Canvas.SetTop(earL, 0);
            var earR = new Ellipse { Width = 9, Height = 9, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(earR, 23); Canvas.SetTop(earR, 0);
            canvas.Children.Add(earL);
            canvas.Children.Add(earR);

            // Minnie Bow (Red Polka Dot)
            var bow = new TextBlock { Text = "🎀", FontSize = 11 };
            Canvas.SetLeft(bow, 13); Canvas.SetTop(bow, -1);
            canvas.Children.Add(bow);

            return canvas;
        }

        // ── VELOCICOASTER VECTOR ART (UNIVERSAL JURASSIC WORLD) ──
        private static Canvas CreatePaddockFence(double stageW, double stageH)
        {
            var canvas = new Canvas { Width = stageW, Height = stageH };

            // Jurassic Paddock Steel Fence Posts
            for (double x = 10; x < stageW; x += 45)
            {
                var post = new Rectangle
                {
                    Width = 4,
                    Height = stageH * 0.45,
                    Fill = new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55))
                };
                Canvas.SetLeft(post, x);
                Canvas.SetTop(post, stageH * 0.55);
                canvas.Children.Add(post);
            }

            // High Voltage Wire Strands
            for (double y = stageH * 0.60; y < stageH * 0.95; y += 14)
            {
                var wire = new Line
                {
                    X1 = 0, Y1 = y,
                    X2 = stageW, Y2 = y,
                    Stroke = new SolidColorBrush(Color.FromArgb(90, 6, 182, 212)), // Cyan Voltage Wire
                    StrokeThickness = 1.0
                };
                canvas.Children.Add(wire);
            }

            return canvas;
        }

        private static Canvas CreateVelociCoasterTrack(double stageW, double stageH)
        {
            var canvas = new Canvas { Width = stageW, Height = stageH };

            // Tubular Coaster Track Rails (Steep Drop Top-Hat Curve)
            string trackGeomStr = $"M -20,{stageH * 0.35} C {stageW * 0.25},{stageH * 0.10} {stageW * 0.40},{stageH * 0.70} {stageW * 0.65},{stageH * 0.40} C {stageW * 0.85},{stageH * 0.15} {stageW * 0.95},{stageH * 0.65} {stageW + 30},{stageH * 0.45}";
            var rail1 = new Path
            {
                Data = Geometry.Parse(trackGeomStr),
                Stroke = new SolidColorBrush(Color.FromRgb(0x06, 0xB6, 0xD4)), // Electric Cyan
                StrokeThickness = 3.5
            };
            var rail2 = new Path
            {
                Data = Geometry.Parse(trackGeomStr),
                Stroke = new SolidColorBrush(Color.FromRgb(0x02, 0x84, 0xC7)),
                StrokeThickness = 1.8,
                Margin = new Thickness(0, 3, 0, 0)
            };
            canvas.Children.Add(rail2);
            canvas.Children.Add(rail1);

            // Support Trusses
            double[] trussX = { stageW * 0.22, stageW * 0.48, stageW * 0.75 };
            foreach (var tx in trussX)
            {
                var truss = new Line
                {
                    X1 = tx, Y1 = stageH * 0.35,
                    X2 = tx, Y2 = stageH,
                    Stroke = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B)),
                    StrokeThickness = 3.0
                };
                canvas.Children.Add(truss);
            }

            return canvas;
        }

        private static Canvas CreateVelociCoasterTrain()
        {
            var canvas = new Canvas { Width = 110, Height = 36 };

            // 3-Car Sleek Coaster Train
            for (int i = 0; i < 3; i++)
            {
                double carX = i * 36;

                // Car Shell (Aerodynamic Cyan/Navy with LED stripe)
                var car = new Rectangle
                {
                    Width = 32,
                    Height = 16,
                    RadiusX = 4,
                    RadiusY = 4,
                    Fill = new LinearGradientBrush(
                        Color.FromRgb(0x0E, 0x74, 0x90),
                        Color.FromRgb(0x08, 0x33, 0x44),
                        new Point(0, 0),
                        new Point(0, 1)),
                    Stroke = new SolidColorBrush(Color.FromRgb(0x06, 0xB6, 0xD4)),
                    StrokeThickness = 1.0
                };
                Canvas.SetLeft(car, carX);
                Canvas.SetTop(car, 14);
                canvas.Children.Add(car);

                // LED Cyan Racing Stripe
                var led = new Rectangle
                {
                    Width = 28,
                    Height = 2.5,
                    Fill = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8))
                };
                Canvas.SetLeft(led, carX + 2);
                Canvas.SetTop(led, 20);
                canvas.Children.Add(led);

                // Screaming Critter Rider with Paws Up in the Air!
                string[] riders = { "🐱", "🐰", "🦆" };
                var rider = new TextBlock
                {
                    Text = riders[i % riders.Length],
                    FontSize = 13
                };
                Canvas.SetLeft(rider, carX + 8);
                Canvas.SetTop(rider, 1);
                canvas.Children.Add(rider);

                // Screaming Paws emoji
                var hands = new TextBlock
                {
                    Text = "🙌",
                    FontSize = 9
                };
                Canvas.SetLeft(hands, carX + 9);
                Canvas.SetTop(hands, -6);
                canvas.Children.Add(hands);
            }

            return canvas;
        }

        private static Canvas CreateVelociRaptor()
        {
            var canvas = new Canvas { Width = 65, Height = 48 };

            var group = new TransformGroup();
            var scale = new ScaleTransform(1, 1);
            group.Children.Add(scale);
            canvas.RenderTransform = group;
            canvas.RenderTransformOrigin = new Point(0.5, 0.5);

            // Raptor Body (Slate Gray with Blue Racing Stripe like 'Blue'!)
            var body = new Path
            {
                Data = Geometry.Parse("M 40,24 C 30,16 12,20 2,24 C 10,28 26,30 36,34 L 42,34 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55))
            };
            canvas.Children.Add(body);

            // Iconic Metallic Blue Racing Stripe
            var blueStripe = new Path
            {
                Data = Geometry.Parse("M 38,23 C 28,17 14,21 4,24 C 12,26 26,27 36,29 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x25, 0x63, 0xEB)) // Vibrant Blue
            };
            canvas.Children.Add(blueStripe);

            // Raptor Head & Roaring Open Jaw
            var head = new Path
            {
                Data = Geometry.Parse("M 36,24 L 56,12 L 60,18 L 48,22 L 58,26 L 46,30 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x47, 0x55, 0x69)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B)),
                StrokeThickness = 0.8
            };
            canvas.Children.Add(head);

            // Glowing Amber Raptor Eye
            var eye = new Ellipse
            {
                Width = 4,
                Height = 4,
                Fill = new SolidColorBrush(Color.FromRgb(0xF5, 0x9E, 0x0B)),
                Effect = new DropShadowEffect { Color = Color.FromRgb(0xF5, 0x9E, 0x0B), BlurRadius = 6, ShadowDepth = 0 }
            };
            Canvas.SetLeft(eye, 46); Canvas.SetTop(eye, 14);
            canvas.Children.Add(eye);

            // Raptor Sickle Claw & Legs
            var leg = new Path
            {
                Data = Geometry.Parse("M 30,30 L 26,44 L 34,44 L 36,38 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55))
            };
            canvas.Children.Add(leg);

            // Roar Speech Bubble
            var roar = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(220, 30, 41, 59)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5),
                Padding = new Thickness(4, 1, 4, 1)
            };
            var roarText = new TextBlock { Text = "ROAAR! 🦖", FontSize = 8.5, FontWeight = FontWeights.Bold, Foreground = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)) };
            roar.Child = roarText;
            Canvas.SetLeft(roar, 18); Canvas.SetTop(roar, -2);
            canvas.Children.Add(roar);

            return canvas;
        }
    }
}

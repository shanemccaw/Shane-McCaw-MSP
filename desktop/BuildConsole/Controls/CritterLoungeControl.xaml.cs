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
        SunsetBeachPicnic = 0,
        NasaKscRocket = 1,
        DisneyMagicKingdom = 2,
        VelociCoaster = 3,
        DeepSpaceMoonbase = 4
    }

    /// <summary>
    /// Critter Lounge Multi-Scene Theater:
    /// 1. 🌅 Sunset Beach & Campfire Lunch (Warm golden hour dusk, campfire with marshmallows, picnic lunch).
    /// 2. 🚀 NASA KSC Launchpad 39B (Artemis Rocket, countdown clock, launchpad floodlights, astronaut critters).
    /// 3. 🏰 Disney Magic Kingdom (Cinderella Castle night facade, fireworks, Sorcerer Mickey, pixie dust).
    /// 4. 🎢 Jurassic World VelociCoaster (High-speed drop, coaster cars with screaming riders, roaring raptors).
    /// 5. 🌌 NASA Deep Space & Lunar Outpost (Earth/Moon view, lunar rover, zero-g floating lunch & astronauts).
    /// Features theatrical red velvet closing/opening curtains for seamless scene changes!
    /// </summary>
    public partial class CritterLoungeControl : UserControl
    {
        private static readonly Random Rng = new();

        private CritterSceneType _currentScene = CritterSceneType.SunsetBeachPicnic;
        private readonly DispatcherTimer _sceneCycleTimer;
        private readonly DispatcherTimer _animationTickTimer;
        private bool _isTransitioning;
        private bool _isActionActive;

        // Active scene animation handles
        private readonly List<UIElement> _animatedElements = new();
        private FrameworkElement? _coasterTrain;
        private FrameworkElement? _raptorMascot;
        private FrameworkElement? _rocketPlume;
        private FrameworkElement? _campfireFlame;

        public CritterLoungeControl()
        {
            InitializeComponent();

            // Auto-cycle scenes every 48 seconds with theatrical curtains
            _sceneCycleTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(48) };
            _sceneCycleTimer.Tick += SceneCycleTimer_Tick;

            // Micro-animation timer for continuous ambient motion (waves, fireworks, rocket smoke, coaster speed)
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
            var next = (CritterSceneType)(((int)_currentScene + 1) % 5);
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
                case CritterSceneType.NasaKscRocket:
                    PulseRocketEnginePuff();
                    break;
                case CritterSceneType.DeepSpaceMoonbase:
                    SpawnZeroGSparkle();
                    break;
                case CritterSceneType.SunsetBeachPicnic:
                    SpawnCampfireSpark();
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
            var next = (CritterSceneType)(((int)_currentScene + 1) % 5);
            TransitionToScene(next);
        }

        private void BtnNextScene_Click(object sender, RoutedEventArgs e)
        {
            if (_isTransitioning) return;
            var next = (CritterSceneType)(((int)_currentScene + 1) % 5);
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
            _rocketPlume = null;
            _campfireFlame = null;
        }

        private void RenderCurrentScene(bool animateCurtain)
        {
            ClearAllCanvases();

            switch (_currentScene)
            {
                case CritterSceneType.SunsetBeachPicnic:
                    BuildSunsetBeachPicnicScene();
                    break;
                case CritterSceneType.NasaKscRocket:
                    BuildNasaKscRocketScene();
                    break;
                case CritterSceneType.DisneyMagicKingdom:
                    BuildDisneyMagicKingdomScene();
                    break;
                case CritterSceneType.VelociCoaster:
                    BuildVelociCoasterScene();
                    break;
                case CritterSceneType.DeepSpaceMoonbase:
                    BuildDeepSpaceMoonbaseScene();
                    break;
            }
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENE 1: 🌅 SUNSET BEACH & CAMPFIRE PICNIC (WARM GOLDEN HOUR DUSK)
        // ══════════════════════════════════════════════════════════════════════
        private void BuildSunsetBeachPicnicScene()
        {
            SceneIcon.Text = "🌅 ";
            SceneTitleText.Text = "SUNSET BEACH & PICNIC";
            SceneSubText.Text = " · campfire & lunch 🍉";
            CheerBtnIcon.Text = "🔥";
            SceneBadge.BorderBrush = new SolidColorBrush(Color.FromRgb(0xF9, 0x73, 0x16)); // Warm Orange

            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            // 1. Warm Golden Hour Sunset Dusk Sky (Deep Indigo -> Twilight Mauve -> Warm Amber Horizon)
            var skyRect = new Rectangle
            {
                Width = w + 40,
                Height = h,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x1E, 0x1B, 0x4B), // Deep Indigo Dusk
                    Color.FromRgb(0x83, 0x18, 0x43), // Twilight Rose/Mauve
                    new Point(0, 0),
                    new Point(0, 0.75))
            };
            BackgroundCanvas.Children.Add(skyRect);

            // Glowing Golden Sunset Sun on Horizon
            var sunsetSun = new Ellipse
            {
                Width = 46,
                Height = 46,
                Fill = new SolidColorBrush(Color.FromRgb(0xFB, 0x92, 0x3C)), // Warm Coral Sunset
                Effect = new DropShadowEffect
                {
                    Color = Color.FromRgb(0xDC, 0x26, 0x26),
                    BlurRadius = 26,
                    ShadowDepth = 0,
                    Opacity = 0.85
                }
            };
            Canvas.SetLeft(sunsetSun, w * 0.45);
            Canvas.SetTop(sunsetSun, h * 0.32);
            BackgroundCanvas.Children.Add(sunsetSun);

            // 2. Twilight Ocean Tide with Amber Sunset Reflections
            var oceanGeom = Geometry.Parse($"M 0,{h * 0.54} C {w * 0.3},{h * 0.50} {w * 0.7},{h * 0.56} {w + 20},{h * 0.52} L {w + 20},{h} L 0,{h} Z");
            var oceanPath = new Path
            {
                Data = oceanGeom,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x0C, 0x4A, 0x6E), // Deep Sapphire Water
                    Color.FromRgb(0x08, 0x2F, 0x49),
                    new Point(0, 0),
                    new Point(0, 1))
            };
            BackgroundCanvas.Children.Add(oceanPath);

            // Glowing sunset reflection streak on water
            var waterGlint = new Rectangle
            {
                Width = 70,
                Height = 12,
                RadiusX = 6,
                RadiusY = 6,
                Fill = new SolidColorBrush(Color.FromArgb(80, 251, 146, 60))
            };
            Canvas.SetLeft(waterGlint, w * 0.42);
            Canvas.SetTop(waterGlint, h * 0.54);
            BackgroundCanvas.Children.Add(waterGlint);

            // 3. Evening Sand Shore (Warm Amber/Brown)
            var sandGeom = Geometry.Parse($"M 0,{h * 0.65} C {w * 0.4},{h * 0.60} {w * 0.8},{h * 0.68} {w + 20},{h * 0.63} L {w + 20},{h} L 0,{h} Z");
            var sandPath = new Path
            {
                Data = sandGeom,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x78, 0x35, 0x0F), // Dark Warm Amber Sand
                    Color.FromRgb(0x45, 0x1A, 0x03),
                    new Point(0, 0),
                    new Point(0, 1))
            };
            BackgroundCanvas.Children.Add(sandPath);

            // 4. Palm Tree Silhouette on Left
            var palmTree = CreateVectorPalmTree(h * 0.85);
            Canvas.SetLeft(palmTree, 10);
            Canvas.SetTop(palmTree, h * 0.16);
            LoungeCanvas.Children.Add(palmTree);

            // 5. Cozy Crackling Beach Campfire 🔥
            var campfire = CreateVectorCampfire();
            _campfireFlame = campfire;
            Canvas.SetLeft(campfire, w * 0.30);
            Canvas.SetTop(campfire, h * 0.62);
            LoungeCanvas.Children.Add(campfire);

            // 6. Picnic Lunch Spread (Basket, Watermelon, Cupcake, Pizza, Coffee) 🍉🧺🍕
            var picnicSpread = CreatePicnicLunchSpread();
            Canvas.SetLeft(picnicSpread, w * 0.48);
            Canvas.SetTop(picnicSpread, h * 0.66);
            LoungeCanvas.Children.Add(picnicSpread);

            // 7. Sunbathing Otter on Lounge Chair watching the sunset
            var loungeChair = CreateVectorLoungeChair();
            Canvas.SetLeft(loungeChair, w * 0.64);
            Canvas.SetTop(loungeChair, h * 0.58);
            LoungeCanvas.Children.Add(loungeChair);

            var sunbather = CreateSunbathingOtter();
            Canvas.SetLeft(sunbather, w * 0.66);
            Canvas.SetTop(sunbather, h * 0.52);
            LoungeCanvas.Children.Add(sunbather);

            // 8. Donald Sailor Duck drifting in sunset sailboat
            var donaldSunset = SailorDuckMascotLayer.CreateSailorDuckInSailboat(75, 75, showSpeechBubble: false);
            Canvas.SetLeft(donaldSunset, w * 0.14);
            Canvas.SetTop(donaldSunset, h * 0.42);
            LoungeCanvas.Children.Add(donaldSunset);
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENE 2: 🚀 NASA KSC LAUNCHPAD 39B (ARTEMIS MOON ROCKET LAUNCH)
        // ══════════════════════════════════════════════════════════════════════
        private void BuildNasaKscRocketScene()
        {
            SceneIcon.Text = "🚀 ";
            SceneTitleText.Text = "NASA KSC LAUNCHPAD 39B";
            SceneSubText.Text = " · Artemis Moon Rocket 🌙";
            CheerBtnIcon.Text = "🚀";
            SceneBadge.BorderBrush = new SolidColorBrush(Color.FromRgb(0x60, 0xA5, 0xFA)); // NASA Blue

            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            // 1. Space Coast Twilight Night Sky
            var skyRect = new Rectangle
            {
                Width = w + 40,
                Height = h,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x03, 0x07, 0x12), // Deep Space Black
                    Color.FromRgb(0x0F, 0x17, 0x2A), // Midnight Slate Navy
                    new Point(0, 0),
                    new Point(0, 1))
            };
            BackgroundCanvas.Children.Add(skyRect);

            // Distant Stars
            for (int i = 0; i < 24; i++)
            {
                var star = new Ellipse
                {
                    Width = Rng.Next(1, 3),
                    Height = Rng.Next(1, 3),
                    Fill = new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0))
                };
                Canvas.SetLeft(star, Rng.Next(10, (int)w - 10));
                Canvas.SetTop(star, Rng.Next(5, (int)(h * 0.65)));
                BackgroundCanvas.Children.Add(star);
            }

            // Launchpad Concrete Foundation
            var padConcrete = new Rectangle
            {
                Width = w + 40,
                Height = h * 0.25,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x1E, 0x29, 0x3B),
                    Color.FromRgb(0x0F, 0x17, 0x2A),
                    new Point(0, 0),
                    new Point(0, 1))
            };
            Canvas.SetTop(padConcrete, h * 0.75);
            BackgroundCanvas.Children.Add(padConcrete);

            // 2. KSC Mobile Launcher Red Steel Tower (Pad 39B)
            var launchTower = CreateKscLaunchTower(h * 0.85);
            Canvas.SetLeft(launchTower, w * 0.36);
            Canvas.SetTop(launchTower, h * 0.08);
            BackgroundCanvas.Children.Add(launchTower);

            // 3. Artemis SLS Moon Rocket Vector with Orange Core Stage & SRBs
            var rocket = CreateArtemisSlsRocket(h * 0.80);
            Canvas.SetLeft(rocket, w * 0.48);
            Canvas.SetTop(rocket, h * 0.10);
            BackgroundCanvas.Children.Add(rocket);

            // Rocket Engine Exhaust Plume & Smoke Plume
            var plume = CreateRocketEnginePlume();
            _rocketPlume = plume;
            Canvas.SetLeft(plume, w * 0.47);
            Canvas.SetTop(plume, h * 0.68);
            BackgroundCanvas.Children.Add(plume);

            // 4. KSC Countdown Clock Digital Panel: "T-MINUS 00:03 ⏱️"
            var countdownBox = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(230, 10, 15, 25)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(5),
                Padding = new Thickness(6, 2, 6, 2)
            };
            var countdownText = new TextBlock
            {
                Text = "⏱️ T-MINUS 00:03 · GO FOR LAUNCH",
                FontSize = 8.5,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Color.FromRgb(0x4A, 0xDE, 0x80)) // Terminal Green
            };
            countdownBox.Child = countdownText;
            Canvas.SetLeft(countdownBox, 10);
            Canvas.SetTop(countdownBox, h * 0.78);
            LoungeCanvas.Children.Add(countdownBox);

            // 5. NASA Astronaut Critters in Full EVA Spacesuits:
            // A. Astronaut Bunny holding NASA mission checklist
            var astroBunny = CreateNasaAstronautCritter("🐰", "MISSION FLIGHT DIR 📋");
            Canvas.SetLeft(astroBunny, w * 0.14);
            Canvas.SetTop(astroBunny, h * 0.58);
            LoungeCanvas.Children.Add(astroBunny);

            // B. Ground Control Otter with dual-monitor command desk & headset 🎧
            var groundControl = CreateGroundControlOtter();
            Canvas.SetLeft(groundControl, w * 0.72);
            Canvas.SetTop(groundControl, h * 0.60);
            LoungeCanvas.Children.Add(groundControl);
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENE 3: 🏰 DISNEY WORLD MAGIC KINGDOM (SHANE'S FAVORITE PLACE!)
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
        // SCENE 4: 🎢 VELOCICOASTER (SHANE'S FAVORITE ROLLER COASTER!)
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
        // SCENE 5: 🌌 NASA DEEP SPACE ORBIT & LUNAR OUTPOST
        // ══════════════════════════════════════════════════════════════════════
        private void BuildDeepSpaceMoonbaseScene()
        {
            SceneIcon.Text = "🌌 ";
            SceneTitleText.Text = "NASA LUNAR GATEWAY";
            SceneSubText.Text = " · zero-g orbit & pizza 🍕";
            CheerBtnIcon.Text = "🛰️";
            SceneBadge.BorderBrush = new SolidColorBrush(Color.FromRgb(0xA8, 0x55, 0xF7)); // Purple Orbit

            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            // 1. Cosmos Deep Space Starfield
            var skyRect = new Rectangle
            {
                Width = w + 40,
                Height = h,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x02, 0x06, 0x17),
                    Color.FromRgb(0x0F, 0x17, 0x2A),
                    new Point(0, 0),
                    new Point(1, 1))
            };
            BackgroundCanvas.Children.Add(skyRect);

            // Glowing Earth "Blue Marble" View in distance
            var earth = new Ellipse
            {
                Width = 36,
                Height = 36,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x02, 0x84, 0xC7),
                    Color.FromRgb(0x15, 0x80, 0x3D),
                    new Point(0, 0),
                    new Point(1, 1)),
                Effect = new DropShadowEffect { Color = Color.FromRgb(0x38, 0xBD, 0xF8), BlurRadius = 14, ShadowDepth = 0 }
            };
            Canvas.SetLeft(earth, w * 0.78);
            Canvas.SetTop(earth, 14);
            BackgroundCanvas.Children.Add(earth);

            // Lunar Surface with Craters
            var moonGround = new Path
            {
                Data = Geometry.Parse($"M 0,{h * 0.72} C {w * 0.3},{h * 0.68} {w * 0.7},{h * 0.76} {w + 20},{h * 0.70} L {w + 20},{h} L 0,{h} Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x47, 0x55, 0x69), // Moon Regolith Gray
                    Color.FromRgb(0x1E, 0x29, 0x3B),
                    new Point(0, 0),
                    new Point(0, 1))
            };
            BackgroundCanvas.Children.Add(moonGround);

            // Lunar Rover with Gold Foil & Dish Antenna
            var rover = CreateLunarRover();
            Canvas.SetLeft(rover, w * 0.12);
            Canvas.SetTop(rover, h * 0.64);
            LoungeCanvas.Children.Add(rover);

            // Astronaut Critter planting NASA Mission Flag 🚩
            var astroMoon = CreateNasaAstronautCritter("🐱", "LUNAR ARTEMIS BASE 🌙");
            Canvas.SetLeft(astroMoon, w * 0.44);
            Canvas.SetTop(astroMoon, h * 0.54);
            LoungeCanvas.Children.Add(astroMoon);

            // Floating Zero-G Space Lunch (Pizza slice, Space Coffee, Cupcake floating!)
            var zeroGLunch = CreateZeroGFloatingLunch();
            Canvas.SetLeft(zeroGLunch, w * 0.68);
            Canvas.SetTop(zeroGLunch, h * 0.36);
            LoungeCanvas.Children.Add(zeroGLunch);
        }

        // ══════════════════════════════════════════════════════════════════════
        // SCENE INTERACTION & CHEER TRIGGERS
        // ══════════════════════════════════════════════════════════════════════
        public void TriggerSceneAction()
        {
            switch (_currentScene)
            {
                case CritterSceneType.SunsetBeachPicnic:
                    SpawnCampfireSpark();
                    SpawnClickSparkles(new Point(ActualWidth * 0.32, 100));
                    break;
                case CritterSceneType.NasaKscRocket:
                    PulseRocketEnginePuff();
                    SpawnClickSparkles(new Point(ActualWidth * 0.50, 70));
                    break;
                case CritterSceneType.DisneyMagicKingdom:
                    for (int i = 0; i < 4; i++)
                    {
                        var t = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(i * 180) };
                        t.Tick += (_, _) => { t.Stop(); SpawnDisneyFirework(); };
                        t.Start();
                    }
                    break;
                case CritterSceneType.VelociCoaster:
                    if (_coasterTrain != null) LaunchCoasterTrainAnimation(_coasterTrain, ActualWidth, ActualHeight);
                    if (_raptorMascot != null) PlayRaptorRoar(_raptorMascot);
                    break;
                case CritterSceneType.DeepSpaceMoonbase:
                    SpawnZeroGSparkle();
                    SpawnClickSparkles(new Point(ActualWidth * 0.68, 60));
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
            string[] icons = { "🚀", "✨", "⭐", "🦖", "🏰", "🌙", "🍉", "🔥" };
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

        private void SpawnCampfireSpark()
        {
            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            double cx = w * 0.32 + Rng.Next(-8, 8);
            double cy = h * 0.65;

            var spark = new Ellipse
            {
                Width = 3,
                Height = 3,
                Fill = new SolidColorBrush(Color.FromRgb(0xFB, 0xBF, 0x24))
            };
            Canvas.SetLeft(spark, cx);
            Canvas.SetTop(spark, cy);
            FxCanvas.Children.Add(spark);

            var yAnim = new DoubleAnimation(cy, cy - 35 - Rng.Next(5, 20), TimeSpan.FromSeconds(1.1));
            var fade = new DoubleAnimation(1.0, 0.0, TimeSpan.FromSeconds(1.1));
            yAnim.Completed += (_, _) => FxCanvas.Children.Remove(spark);

            spark.BeginAnimation(Canvas.TopProperty, yAnim);
            spark.BeginAnimation(OpacityProperty, fade);
        }

        private void PulseRocketEnginePuff()
        {
            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            double px = w * 0.49 + Rng.Next(-10, 10);
            double py = h * 0.72;

            var smoke = new Ellipse
            {
                Width = 14 + Rng.Next(0, 10),
                Height = 14 + Rng.Next(0, 10),
                Fill = new SolidColorBrush(Color.FromArgb(140, 241, 245, 249))
            };
            Canvas.SetLeft(smoke, px);
            Canvas.SetTop(smoke, py);
            FxCanvas.Children.Add(smoke);

            var xAnim = new DoubleAnimation(px, px + Rng.Next(-30, 30), TimeSpan.FromSeconds(1.2));
            var scale = new DoubleAnimation(1.0, 2.2, TimeSpan.FromSeconds(1.2));
            var fade = new DoubleAnimation(0.8, 0.0, TimeSpan.FromSeconds(1.2));

            var group = new TransformGroup();
            var st = new ScaleTransform(1, 1);
            group.Children.Add(st);
            smoke.RenderTransform = group;

            fade.Completed += (_, _) => FxCanvas.Children.Remove(smoke);

            st.BeginAnimation(ScaleTransform.ScaleXProperty, scale);
            st.BeginAnimation(ScaleTransform.ScaleYProperty, scale);
            smoke.BeginAnimation(Canvas.LeftProperty, xAnim);
            smoke.BeginAnimation(OpacityProperty, fade);
        }

        private void SpawnZeroGSparkle()
        {
            double w = ActualWidth > 50 ? ActualWidth : 360;
            double h = ActualHeight > 50 ? ActualHeight : 172;

            var star = new TextBlock
            {
                Text = "✨",
                FontSize = 10,
                Foreground = new SolidColorBrush(Color.FromRgb(0x67, 0xE8, 0xF9))
            };
            Canvas.SetLeft(star, w * 0.70 + Rng.Next(-25, 25));
            Canvas.SetTop(star, h * 0.38 + Rng.Next(-20, 20));
            FxCanvas.Children.Add(star);

            var fade = new DoubleAnimation(1.0, 0.0, TimeSpan.FromSeconds(1.4));
            fade.Completed += (_, _) => FxCanvas.Children.Remove(star);
            star.BeginAnimation(OpacityProperty, fade);
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

            var xAnim = new DoubleAnimation(-120, w + 120, TimeSpan.FromSeconds(1.8))
            {
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };

            var yAnim = new DoubleAnimation(h * 0.35, h * 0.55, TimeSpan.FromSeconds(0.9))
            {
                AutoReverse = true,
                EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
            };

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
        // VECTOR ART BUILDERS (PALM TREE, CAMPFIRE, NASA ROCKET, ROVER, LUNCH)
        // ══════════════════════════════════════════════════════════════════════

        private static Canvas CreateVectorPalmTree(double height)
        {
            var canvas = new Canvas { Width = 75, Height = height };

            // Curved segmented trunk (Sunset Silhouette)
            var trunkGeom = Geometry.Parse("M 36,95 C 38,60 28,30 32,10 C 35,10 42,30 40,60 C 39,75 42,95 42,95 Z");
            var trunkPath = new Path
            {
                Data = trunkGeom,
                Fill = new SolidColorBrush(Color.FromRgb(0x45, 0x1A, 0x03)) // Silhouette Brown
            };
            canvas.Children.Add(trunkPath);

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
                    Fill = new SolidColorBrush(Color.FromRgb(0x14, 0x53, 0x2D)) // Dark Evening Green
                };
                canvas.Children.Add(frond);
            }

            return canvas;
        }

        private static Canvas CreateVectorCampfire()
        {
            var canvas = new Canvas { Width = 42, Height = 36 };

            // Firewood logs
            var log1 = new Line { X1 = 6, Y1 = 30, X2 = 36, Y2 = 30, Stroke = new SolidColorBrush(Color.FromRgb(0x78, 0x35, 0x0F)), StrokeThickness = 4.5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round };
            var log2 = new Line { X1 = 10, Y1 = 26, X2 = 32, Y2 = 34, Stroke = new SolidColorBrush(Color.FromRgb(0x45, 0x1A, 0x03)), StrokeThickness = 4.0, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round };
            canvas.Children.Add(log1);
            canvas.Children.Add(log2);

            // Flickering Campfire Flame 🔥
            var flame = new Path
            {
                Data = Geometry.Parse("M 14,30 C 10,22 18,12 21,4 C 24,12 32,22 28,30 C 25,32 17,32 14,30 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xFE, 0xF0, 0x8A), // Yellow Core
                    Color.FromRgb(0xEF, 0x44, 0x44), // Orange/Red Outer
                    new Point(0, 0),
                    new Point(0, 1)),
                Effect = new DropShadowEffect { Color = Color.FromRgb(0xF5, 0x9E, 0x0B), BlurRadius = 12, ShadowDepth = 0 }
            };
            canvas.Children.Add(flame);

            // Marshmallow on stick
            var stick = new Line { X1 = 34, Y1 = 12, X2 = 44, Y2 = 0, Stroke = new SolidColorBrush(Color.FromRgb(0xD9, 0x77, 0x06)), StrokeThickness = 1.5 };
            var mallow = new Rectangle { Width = 6, Height = 4, RadiusX = 2, RadiusY = 2, Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)) };
            Canvas.SetLeft(mallow, 32); Canvas.SetTop(mallow, 10);
            canvas.Children.Add(stick);
            canvas.Children.Add(mallow);

            return canvas;
        }

        private static Canvas CreatePicnicLunchSpread()
        {
            var canvas = new Canvas { Width = 70, Height = 32 };

            // Picnic Blanket (Red/White Gingham)
            var blanket = new Rectangle
            {
                Width = 60,
                Height = 16,
                RadiusX = 3,
                RadiusY = 3,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x99, 0x1B, 0x1B),
                    Color.FromRgb(0xEF, 0x44, 0x44),
                    new Point(0, 0),
                    new Point(1, 0))
            };
            Canvas.SetTop(blanket, 14);
            canvas.Children.Add(blanket);

            // Lunch Items: Picnic Basket 🧺, Watermelon 🍉, Cupcake 🧁, Pizza 🍕, Coffee ☕
            var basket = new TextBlock { Text = "🧺", FontSize = 12 };
            Canvas.SetLeft(basket, 2); Canvas.SetTop(basket, 4);
            canvas.Children.Add(basket);

            var melon = new TextBlock { Text = "🍉", FontSize = 11 };
            Canvas.SetLeft(melon, 16); Canvas.SetTop(melon, 6);
            canvas.Children.Add(melon);

            var pizza = new TextBlock { Text = "🍕", FontSize = 11 };
            Canvas.SetLeft(pizza, 28); Canvas.SetTop(pizza, 6);
            canvas.Children.Add(pizza);

            var cupcake = new TextBlock { Text = "🧁", FontSize = 10 };
            Canvas.SetLeft(cupcake, 40); Canvas.SetTop(cupcake, 7);
            canvas.Children.Add(cupcake);

            var coffee = new TextBlock { Text = "☕", FontSize = 9 };
            Canvas.SetLeft(coffee, 50); Canvas.SetTop(coffee, 8);
            canvas.Children.Add(coffee);

            return canvas;
        }

        private static Canvas CreateVectorLoungeChair()
        {
            var canvas = new Canvas { Width = 65, Height = 45 };

            // Umbrella Pole
            var umbrellaPole = new Rectangle { Width = 2.5, Height = 36, Fill = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)) };
            Canvas.SetLeft(umbrellaPole, 14); Canvas.SetTop(umbrellaPole, 2);
            canvas.Children.Add(umbrellaPole);

            var umbrellaCanopy = new Path
            {
                Data = Geometry.Parse("M 0,12 C 4,2 24,2 28,12 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x99, 0x1B, 0x1B), // Sunset Crimson/Gold
                    Color.FromRgb(0xF5, 0x9E, 0x0B),
                    new Point(0, 0),
                    new Point(1, 0))
            };
            canvas.Children.Add(umbrellaCanopy);

            // Wooden Reclining Lounge Chair
            var chairBase = new Path
            {
                Data = Geometry.Parse("M 18,34 L 54,34 L 62,24 L 60,22 L 52,32 L 20,32 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0xB4, 0x53, 0x09))
            };
            canvas.Children.Add(chairBase);

            // Cold Drink with Straw
            var drink = new TextBlock { Text = "🍹", FontSize = 12 };
            Canvas.SetLeft(drink, 4); Canvas.SetTop(drink, 24);
            canvas.Children.Add(drink);

            return canvas;
        }

        private static Canvas CreateSunbathingOtter()
        {
            var canvas = new Canvas { Width = 38, Height = 28 };

            var body = new Ellipse { Width = 24, Height = 12, Fill = new SolidColorBrush(Color.FromRgb(0x8D, 0x5B, 0x4C)) };
            Canvas.SetLeft(body, 8); Canvas.SetTop(body, 8);
            canvas.Children.Add(body);

            var head = new Ellipse { Width = 14, Height = 12, Fill = new SolidColorBrush(Color.FromRgb(0x9E, 0x6B, 0x5C)) };
            Canvas.SetLeft(head, 22); Canvas.SetTop(head, 4);
            canvas.Children.Add(head);

            var glasses = new Path
            {
                Data = Geometry.Parse("M 24,7 L 34,7 L 33,10 L 29,10 L 28,8 L 25,10 L 23,8 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B))
            };
            canvas.Children.Add(glasses);

            return canvas;
        }

        // ── KSC LAUNCHPAD & ARTEMIS ROCKET VECTOR ART ──
        private static Canvas CreateKscLaunchTower(double height)
        {
            var canvas = new Canvas { Width = 45, Height = height };

            // Red Steel Mobile Launcher Tower
            var tower = new Rectangle
            {
                Width = 24,
                Height = height,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x99, 0x1B, 0x1B), // KSC Red/Steel
                    Color.FromRgb(0x7F, 0x1D, 0x1D),
                    new Point(0, 0),
                    new Point(1, 0)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x45, 0x0A, 0x0A)),
                StrokeThickness = 1.0
            };
            canvas.Children.Add(tower);

            // Tower Lattice Struts
            for (double y = 10; y < height; y += 14)
            {
                var strut = new Line { X1 = 0, Y1 = y, X2 = 24, Y2 = y + 10, Stroke = new SolidColorBrush(Color.FromRgb(0xEF, 0x44, 0x44)), StrokeThickness = 1.0 };
                canvas.Children.Add(strut);
            }

            // Crew Access Arm swinging to the rocket
            var crewArm = new Rectangle { Width = 28, Height = 5, Fill = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)) };
            Canvas.SetLeft(crewArm, 18); Canvas.SetTop(crewArm, height * 0.22);
            canvas.Children.Add(crewArm);

            return canvas;
        }

        private static Canvas CreateArtemisSlsRocket(double height)
        {
            var canvas = new Canvas { Width = 44, Height = height };

            // Core Stage (Iconic NASA Artemis Orange Foam)
            var core = new Rectangle
            {
                Width = 16,
                Height = height * 0.65,
                RadiusX = 2,
                RadiusY = 2,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xEA, 0x58, 0x0C), // Orange Core
                    Color.FromRgb(0xC2, 0x41, 0x0C),
                    new Point(0, 0),
                    new Point(1, 0))
            };
            Canvas.SetLeft(core, 14); Canvas.SetTop(core, height * 0.24);
            canvas.Children.Add(core);

            // Orion Capsule + Launch Abort System on Top
            var orion = new Path
            {
                Data = Geometry.Parse("M 14,30 L 22,10 L 30,30 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0xFA, 0xFA, 0xFA))
            };
            canvas.Children.Add(orion);
            var abortNeedle = new Line { X1 = 22, Y1 = 10, X2 = 22, Y2 = 0, Stroke = new SolidColorBrush(Color.FromRgb(0xFA, 0xFA, 0xFA)), StrokeThickness = 1.5 };
            canvas.Children.Add(abortNeedle);

            // Dual Solid Rocket Boosters (White SRBs with Black Nose Cones)
            var srbL = new Rectangle { Width = 6, Height = height * 0.60, Fill = new SolidColorBrush(Color.FromRgb(0xFA, 0xFA, 0xFA)) };
            Canvas.SetLeft(srbL, 6); Canvas.SetTop(srbL, height * 0.28);
            var srbR = new Rectangle { Width = 6, Height = height * 0.60, Fill = new SolidColorBrush(Color.FromRgb(0xFA, 0xFA, 0xFA)) };
            Canvas.SetLeft(srbR, 32); Canvas.SetTop(srbR, height * 0.28);
            canvas.Children.Add(srbL);
            canvas.Children.Add(srbR);

            // NASA "Meatball" Logo Dot
            var logo = new Ellipse { Width = 5, Height = 5, Fill = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8)) };
            Canvas.SetLeft(logo, 19.5); Canvas.SetTop(logo, height * 0.35);
            canvas.Children.Add(logo);

            return canvas;
        }

        private static Canvas CreateRocketEnginePlume()
        {
            var canvas = new Canvas { Width = 30, Height = 36 };

            // Engine Flame Core
            var flame = new Path
            {
                Data = Geometry.Parse("M 8,0 L 22,0 L 18,32 L 15,36 L 12,32 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xFE, 0xF0, 0x8A),
                    Color.FromRgb(0xEF, 0x44, 0x44),
                    new Point(0, 0),
                    new Point(0, 1)),
                Effect = new DropShadowEffect { Color = Color.FromRgb(0xF5, 0x9E, 0x0B), BlurRadius = 14, ShadowDepth = 0 }
            };
            canvas.Children.Add(flame);

            return canvas;
        }

        private static Canvas CreateNasaAstronautCritter(string critterEmoji, string roleTitle)
        {
            var canvas = new Canvas { Width = 48, Height = 54 };

            // White NASA Spacesuit Body
            var suit = new Rectangle
            {
                Width = 24,
                Height = 24,
                RadiusX = 6,
                RadiusY = 6,
                Fill = new SolidColorBrush(Color.FromRgb(0xF8, 0xFA, 0xFC)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x64, 0x74, 0x8B)),
                StrokeThickness = 1.0
            };
            Canvas.SetLeft(suit, 12); Canvas.SetTop(suit, 18);
            canvas.Children.Add(suit);

            // NASA Blue Meatball Patch on Chest
            var patch = new Ellipse { Width = 5, Height = 5, Fill = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8)) };
            Canvas.SetLeft(patch, 16); Canvas.SetTop(patch, 22);
            canvas.Children.Add(patch);

            // Gold Reflective Bubble Visor Helmet 👨‍🚀
            var helmet = new Ellipse
            {
                Width = 26,
                Height = 22,
                Fill = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A)),
                Stroke = new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0)),
                StrokeThickness = 1.2
            };
            Canvas.SetLeft(helmet, 11); Canvas.SetTop(helmet, 2);
            canvas.Children.Add(helmet);

            var goldVisor = new Ellipse
            {
                Width = 18,
                Height = 13,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xFE, 0xF0, 0x8A),
                    Color.FromRgb(0xD9, 0x77, 0x06),
                    new Point(0, 0),
                    new Point(1, 1))
            };
            Canvas.SetLeft(goldVisor, 15); Canvas.SetTop(goldVisor, 6.5);
            canvas.Children.Add(goldVisor);

            // Critter Inside
            var critter = new TextBlock { Text = critterEmoji, FontSize = 10 };
            Canvas.SetLeft(critter, 19); Canvas.SetTop(critter, 6);
            canvas.Children.Add(critter);

            return canvas;
        }

        private static Canvas CreateGroundControlOtter()
        {
            var canvas = new Canvas { Width = 50, Height = 45 };

            // Computer Terminal Desk
            var desk = new Rectangle { Width = 38, Height = 18, RadiusX = 2, RadiusY = 2, Fill = new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55)) };
            Canvas.SetLeft(desk, 6); Canvas.SetTop(desk, 22);
            canvas.Children.Add(desk);

            // Glowing Monitor with Flight Telemetry
            var screen = new Rectangle { Width = 18, Height = 12, Fill = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A)), Stroke = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8)), StrokeThickness = 0.8 };
            Canvas.SetLeft(screen, 16); Canvas.SetTop(screen, 10);
            canvas.Children.Add(screen);

            // Otter with Headset
            var otter = new TextBlock { Text = "🦦🎧", FontSize = 13 };
            Canvas.SetLeft(otter, 14); Canvas.SetTop(otter, 0);
            canvas.Children.Add(otter);

            return canvas;
        }

        // ── LUNAR ROVER & ZERO-G LUNCH ──
        private static Canvas CreateLunarRover()
        {
            var canvas = new Canvas { Width = 55, Height = 36 };

            // Rover Body Frame with Gold Foil
            var frame = new Rectangle
            {
                Width = 32,
                Height = 10,
                RadiusX = 2,
                RadiusY = 2,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xF5, 0x9E, 0x0B), // Gold Thermal Foil
                    Color.FromRgb(0xD9, 0x77, 0x06),
                    new Point(0, 0),
                    new Point(0, 1))
            };
            Canvas.SetLeft(frame, 12); Canvas.SetTop(frame, 14);
            canvas.Children.Add(frame);

            // Mesh Wire Wheels
            var wheel1 = new Ellipse { Width = 10, Height = 10, Stroke = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)), StrokeThickness = 1.8, Fill = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B)) };
            Canvas.SetLeft(wheel1, 8); Canvas.SetTop(wheel1, 18);
            var wheel2 = new Ellipse { Width = 10, Height = 10, Stroke = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)), StrokeThickness = 1.8, Fill = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B)) };
            Canvas.SetLeft(wheel2, 36); Canvas.SetTop(wheel2, 18);
            canvas.Children.Add(wheel1);
            canvas.Children.Add(wheel2);

            // High-Gain Dish Antenna
            var dish = new Path { Data = Geometry.Parse("M 20,4 C 24,0 30,0 34,4 Z"), Fill = new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0)) };
            var dishMast = new Line { X1 = 27, Y1 = 4, X2 = 27, Y2 = 14, Stroke = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)), StrokeThickness = 1.2 };
            canvas.Children.Add(dishMast);
            canvas.Children.Add(dish);

            return canvas;
        }

        private static Canvas CreateZeroGFloatingLunch()
        {
            var canvas = new Canvas { Width = 65, Height = 40 };

            // Floating Space Pizza Slice 🍕
            var pizza = new TextBlock { Text = "🍕", FontSize = 12 };
            Canvas.SetLeft(pizza, 8); Canvas.SetTop(pizza, 14);
            canvas.Children.Add(pizza);

            // Floating Space Coffee Drink Pouch ☕
            var coffee = new TextBlock { Text = "☕", FontSize = 10 };
            Canvas.SetLeft(coffee, 28); Canvas.SetTop(coffee, 4);
            canvas.Children.Add(coffee);

            // Floating Space Donut 🍩
            var donut = new TextBlock { Text = "🍩", FontSize = 11 };
            Canvas.SetLeft(donut, 44); Canvas.SetTop(donut, 18);
            canvas.Children.Add(donut);

            // Ambient gentle zero-g bobbing
            var trans = new TranslateTransform();
            canvas.RenderTransform = trans;
            var bob = new DoubleAnimation(-5, 5, TimeSpan.FromSeconds(1.8))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            trans.BeginAnimation(TranslateTransform.YProperty, bob);

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
            var leftRoof = new Path { Data = Geometry.Parse("M 38,55 L 49,18 L 60,55 Z"), Fill = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8)) };
            canvas.Children.Add(leftRoof);
            var leftFinial = new Ellipse { Width = 4, Height = 4, Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)) };
            Canvas.SetLeft(leftFinial, 47); Canvas.SetTop(leftFinial, 16);
            canvas.Children.Add(leftFinial);

            var rightRoof = new Path { Data = Geometry.Parse("M 160,55 L 171,18 L 182,55 Z"), Fill = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8)) };
            canvas.Children.Add(rightRoof);
            var rightFinial = new Ellipse { Width = 4, Height = 4, Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)) };
            Canvas.SetLeft(rightFinial, 169); Canvas.SetTop(rightFinial, 16);
            canvas.Children.Add(rightFinial);

            var centerTower = new Rectangle { Width = 40, Height = 36, Fill = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)) };
            Canvas.SetLeft(centerTower, 90); Canvas.SetTop(centerTower, 18);
            canvas.Children.Add(centerTower);

            var centerRoof = new Path
            {
                Data = Geometry.Parse("M 86,20 L 110,-12 L 134,20 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x25, 0x63, 0xEB),
                    Color.FromRgb(0x1E, 0x3A, 0x8A),
                    new Point(0, 0),
                    new Point(0, 1))
            };
            canvas.Children.Add(centerRoof);

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

            double[][] windowCoords = new double[][]
            {
                new double[] { 50, 72 },
                new double[] { 160, 72 },
                new double[] { 105, 42 }
            };
            foreach (var wc in windowCoords)
            {
                var win = new Rectangle { Width = 6, Height = 9, RadiusX = 3, RadiusY = 3, Fill = new SolidColorBrush(Color.FromRgb(0xFE, 0xF0, 0x8A)) };
                Canvas.SetLeft(win, wc[0]); Canvas.SetTop(win, wc[1]);
                canvas.Children.Add(win);
            }

            return canvas;
        }

        private static Canvas CreateSorcererMickeyCritter()
        {
            var canvas = new Canvas { Width = 45, Height = 48 };

            var robe = new Path { Data = Geometry.Parse("M 15,22 L 30,22 L 34,44 L 11,44 Z"), Fill = new SolidColorBrush(Color.FromRgb(0xDC, 0x26, 0x26)) };
            canvas.Children.Add(robe);

            var head = new Ellipse { Width = 18, Height = 18, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(head, 13.5); Canvas.SetTop(head, 8);
            canvas.Children.Add(head);

            var earL = new Ellipse { Width = 11, Height = 11, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(earL, 7); Canvas.SetTop(earL, 2);
            var earR = new Ellipse { Width = 11, Height = 11, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(earR, 27); Canvas.SetTop(earR, 2);
            canvas.Children.Add(earL);
            canvas.Children.Add(earR);

            var hat = new Path { Data = Geometry.Parse("M 14,9 L 22.5,-6 L 31,9 Z"), Fill = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8)) };
            canvas.Children.Add(hat);
            var star = new TextBlock { Text = "⭐", FontSize = 7 };
            Canvas.SetLeft(star, 19); Canvas.SetTop(star, -1);
            canvas.Children.Add(star);

            var wand = new TextBlock { Text = "🪄", FontSize = 12 };
            Canvas.SetLeft(wand, 26); Canvas.SetTop(wand, 20);
            canvas.Children.Add(wand);

            return canvas;
        }

        private static Canvas CreateMickeyEarsBunny()
        {
            var canvas = new Canvas { Width = 38, Height = 40 };

            var body = new Ellipse { Width = 20, Height = 22, Fill = new SolidColorBrush(Color.FromRgb(0xFA, 0xFA, 0xFA)) };
            Canvas.SetLeft(body, 9); Canvas.SetTop(body, 16);
            canvas.Children.Add(body);

            var head = new Ellipse { Width = 16, Height = 16, Fill = new SolidColorBrush(Color.FromRgb(0xFA, 0xFA, 0xFA)) };
            Canvas.SetLeft(head, 11); Canvas.SetTop(head, 6);
            canvas.Children.Add(head);

            var earL = new Ellipse { Width = 9, Height = 9, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(earL, 6); Canvas.SetTop(earL, 0);
            var earR = new Ellipse { Width = 9, Height = 9, Fill = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)) };
            Canvas.SetLeft(earR, 23); Canvas.SetTop(earR, 0);
            canvas.Children.Add(earL);
            canvas.Children.Add(earR);

            var bow = new TextBlock { Text = "🎀", FontSize = 11 };
            Canvas.SetLeft(bow, 13); Canvas.SetTop(bow, -1);
            canvas.Children.Add(bow);

            return canvas;
        }

        // ── VELOCICOASTER VECTOR ART (UNIVERSAL JURASSIC WORLD) ──
        private static Canvas CreatePaddockFence(double stageW, double stageH)
        {
            var canvas = new Canvas { Width = stageW, Height = stageH };

            for (double x = 10; x < stageW; x += 45)
            {
                var post = new Rectangle { Width = 4, Height = stageH * 0.45, Fill = new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55)) };
                Canvas.SetLeft(post, x);
                Canvas.SetTop(post, stageH * 0.55);
                canvas.Children.Add(post);
            }

            for (double y = stageH * 0.60; y < stageH * 0.95; y += 14)
            {
                var wire = new Line
                {
                    X1 = 0, Y1 = y,
                    X2 = stageW, Y2 = y,
                    Stroke = new SolidColorBrush(Color.FromArgb(90, 6, 182, 212)),
                    StrokeThickness = 1.0
                };
                canvas.Children.Add(wire);
            }

            return canvas;
        }

        private static Canvas CreateVelociCoasterTrack(double stageW, double stageH)
        {
            var canvas = new Canvas { Width = stageW, Height = stageH };

            string trackGeomStr = $"M -20,{stageH * 0.35} C {stageW * 0.25},{stageH * 0.10} {stageW * 0.40},{stageH * 0.70} {stageW * 0.65},{stageH * 0.40} C {stageW * 0.85},{stageH * 0.15} {stageW * 0.95},{stageH * 0.65} {stageW + 30},{stageH * 0.45}";
            var rail1 = new Path
            {
                Data = Geometry.Parse(trackGeomStr),
                Stroke = new SolidColorBrush(Color.FromRgb(0x06, 0xB6, 0xD4)),
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

            double[] trussX = { stageW * 0.22, stageW * 0.48, stageW * 0.75 };
            foreach (var tx in trussX)
            {
                var truss = new Line { X1 = tx, Y1 = stageH * 0.35, X2 = tx, Y2 = stageH, Stroke = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B)), StrokeThickness = 3.0 };
                canvas.Children.Add(truss);
            }

            return canvas;
        }

        private static Canvas CreateVelociCoasterTrain()
        {
            var canvas = new Canvas { Width = 110, Height = 36 };

            for (int i = 0; i < 3; i++)
            {
                double carX = i * 36;

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

                var led = new Rectangle { Width = 28, Height = 2.5, Fill = new SolidColorBrush(Color.FromRgb(0x38, 0xBD, 0xF8)) };
                Canvas.SetLeft(led, carX + 2);
                Canvas.SetTop(led, 20);
                canvas.Children.Add(led);

                string[] riders = { "🐱", "🐰", "🦆" };
                var rider = new TextBlock { Text = riders[i % riders.Length], FontSize = 13 };
                Canvas.SetLeft(rider, carX + 8);
                Canvas.SetTop(rider, 1);
                canvas.Children.Add(rider);

                var hands = new TextBlock { Text = "🙌", FontSize = 9 };
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

            var body = new Path
            {
                Data = Geometry.Parse("M 40,24 C 30,16 12,20 2,24 C 10,28 26,30 36,34 L 42,34 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55))
            };
            canvas.Children.Add(body);

            var blueStripe = new Path
            {
                Data = Geometry.Parse("M 38,23 C 28,17 14,21 4,24 C 12,26 26,27 36,29 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x25, 0x63, 0xEB))
            };
            canvas.Children.Add(blueStripe);

            var head = new Path
            {
                Data = Geometry.Parse("M 36,24 L 56,12 L 60,18 L 48,22 L 58,26 L 46,30 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x47, 0x55, 0x69)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B)),
                StrokeThickness = 0.8
            };
            canvas.Children.Add(head);

            var eye = new Ellipse
            {
                Width = 4,
                Height = 4,
                Fill = new SolidColorBrush(Color.FromRgb(0xF5, 0x9E, 0x0B)),
                Effect = new DropShadowEffect { Color = Color.FromRgb(0xF5, 0x9E, 0x0B), BlurRadius = 6, ShadowDepth = 0 }
            };
            Canvas.SetLeft(eye, 46); Canvas.SetTop(eye, 14);
            canvas.Children.Add(eye);

            var leg = new Path
            {
                Data = Geometry.Parse("M 30,30 L 26,44 L 34,44 L 36,38 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x33, 0x41, 0x55))
            };
            canvas.Children.Add(leg);

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

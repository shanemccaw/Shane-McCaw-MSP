using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using System.Windows.Threading;
using BuildConsole.Services;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Sailor Duck Mascot Layer (Inspired by classic cartoon aesthetics / Donald Duck):
    /// A charming animated sailor duck in a tiny white sailboat that:
    /// 1. Sails smoothly across the screen with gentle wave bobbing and water ripples.
    /// 2. Rests in the center of the screen when the user is idle, dropping anchor.
    /// 3. Celebrates builds, deploys, and milestone achievements with confetti and banners.
    /// 4. Floats ON TOP of WebView2 tabs using an Airspace-free transparent layered overlay window.
    /// </summary>
    public partial class SailorDuckMascotLayer : UserControl
    {
        private static readonly Random Rng = new();

        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TRANSPARENT = 0x00000020;
        private const int WS_EX_TOOLWINDOW = 0x00000080;

        [DllImport("user32.dll")]
        private static extern int GetWindowLong(IntPtr hwnd, int index);

        [DllImport("user32.dll")]
        private static extern int SetWindowLong(IntPtr hwnd, int index, int newStyle);

        [StructLayout(LayoutKind.Sequential)]
        private struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        [DllImport("user32.dll")]
        private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        /// <summary>
        /// Gets the number of seconds since the user's last physical mouse movement,
        /// click, scroll wheel action, or keystroke anywhere across the system.
        /// </summary>
        public static double GetSystemIdleSeconds()
        {
            try
            {
                var lii = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
                if (GetLastInputInfo(ref lii))
                {
                    uint currentTick = (uint)Environment.TickCount;
                    uint idleTicks = currentTick - lii.dwTime;
                    return idleTicks / 1000.0;
                }
            }
            catch { }
            return 0;
        }

        private Window? _overlayWindow;
        private Canvas? _overlayMascotCanvas;
        private Canvas? _overlayFxCanvas;

        private Canvas TargetMascotCanvas => _overlayMascotCanvas ?? MascotCanvas;
        private Canvas TargetFxCanvas => _overlayFxCanvas ?? FxCanvas;
        private double StageWidth => _overlayWindow != null && _overlayWindow.ActualWidth > 50 ? _overlayWindow.ActualWidth : ActualWidth;
        private double StageHeight => _overlayWindow != null && _overlayWindow.ActualHeight > 50 ? _overlayWindow.ActualHeight : ActualHeight;

        private readonly DispatcherTimer _idleCheckTimer;
        private DateTime _lastUserActivity = DateTime.UtcNow;
        private bool _isIdleMascotActive;
        private FrameworkElement? _activeIdleMascot;
        private bool _isSailingInProgress;

        // Customization & Quotes
        private static readonly string[] SailorQuips = new[]
        {
            "Quack! Ahoy Captain Shane! ⚓",
            "Full speed ahead! ⛵",
            "Smooth sailing today! 🌊",
            "Looking good, Captain! 🦆",
            "Code is looking shipshape! 🚀",
            "Catching the wind! 💨",
            "Drop anchor and take a breath! ⚓",
            "Aye aye, Captain Shane! ⭐",
            "Quack quack! Best build yet! 🎉",
            "Sailing through the backlog! 📋"
        };

        private static readonly string[] CelebrationQuips = new[]
        {
            "⚓ BUILD COMPLETE! QUACK! 🎉",
            "🚀 DEPLOYED SHIPSHAPE! ⭐",
            "🏆 MILESTONE CRUSHED! 🦆",
            "✨ PERFECT RUN, CAPTAIN! 🌊"
        };

        public SailorDuckMascotLayer()
        {
            InitializeComponent();

            // Idle check timer (checks every 2 seconds for 2.5-4 minutes of real zero-input)
            _idleCheckTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };
            _idleCheckTimer.Tick += IdleCheckTimer_Tick;

            Loaded += SailorDuckMascotLayer_Loaded;
            Unloaded += SailorDuckMascotLayer_Unloaded;
        }

        private void SailorDuckMascotLayer_Loaded(object sender, RoutedEventArgs e)
        {
            EnsureAirspaceFreeOverlayWindow();
            _idleCheckTimer.Start();
            NotifyUserActivity();
        }

        private void SailorDuckMascotLayer_Unloaded(object sender, RoutedEventArgs e)
        {
            _idleCheckTimer.Stop();
            TargetMascotCanvas.Children.Clear();
            TargetFxCanvas.Children.Clear();

            try
            {
                _overlayWindow?.Close();
            }
            catch { }
            _overlayWindow = null;
        }

        private void EnsureAirspaceFreeOverlayWindow()
        {
            if (_overlayWindow != null) return;
            var parentWin = Window.GetWindow(this);
            if (parentWin == null) return;

            var rootGrid = new Grid { IsHitTestVisible = false, ClipToBounds = true };
            _overlayMascotCanvas = new Canvas { IsHitTestVisible = false, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
            _overlayFxCanvas = new Canvas { IsHitTestVisible = false, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch };
            rootGrid.Children.Add(_overlayMascotCanvas);
            rootGrid.Children.Add(_overlayFxCanvas);

            _overlayWindow = new Window
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
                Owner = parentWin,
                Content = rootGrid
            };

            _overlayWindow.SourceInitialized += (s, e) =>
            {
                try
                {
                    var hwnd = new WindowInteropHelper(_overlayWindow).Handle;
                    int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
                    SetWindowLong(hwnd, GWL_EXSTYLE, exStyle | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW);
                }
                catch { }
            };

            parentWin.LocationChanged += (_, _) => SyncOverlayBounds(parentWin);
            parentWin.SizeChanged += (_, _) => SyncOverlayBounds(parentWin);
            parentWin.StateChanged += (_, _) => SyncOverlayBounds(parentWin);
            parentWin.IsVisibleChanged += (_, _) =>
            {
                if (_overlayWindow != null)
                    _overlayWindow.Visibility = (parentWin.IsVisible && parentWin.WindowState != WindowState.Minimized) ? Visibility.Visible : Visibility.Collapsed;
            };
            parentWin.Closed += (_, _) =>
            {
                try { _overlayWindow?.Close(); } catch { }
                _overlayWindow = null;
            };

            try
            {
                _overlayWindow.Show();
                SyncOverlayBounds(parentWin);
            }
            catch { }
        }

        private void SyncOverlayBounds(Window parentWin)
        {
            if (_overlayWindow == null || !parentWin.IsLoaded) return;
            if (parentWin.WindowState == WindowState.Minimized || !parentWin.IsVisible)
            {
                _overlayWindow.Visibility = Visibility.Collapsed;
                return;
            }

            try
            {
                Point screenPoint = parentWin.PointToScreen(new Point(0, 0));
                var source = PresentationSource.FromVisual(parentWin);
                double dpiX = source?.CompositionTarget?.TransformToDevice.M11 ?? 1.0;
                double dpiY = source?.CompositionTarget?.TransformToDevice.M22 ?? 1.0;

                _overlayWindow.Left = screenPoint.X / dpiX;
                _overlayWindow.Top = screenPoint.Y / dpiY;
                _overlayWindow.Width = Math.Max(100, parentWin.ActualWidth);
                _overlayWindow.Height = Math.Max(100, parentWin.ActualHeight);
                _overlayWindow.Visibility = Visibility.Visible;
            }
            catch { }
        }

        /// <summary>
        /// Call whenever the user types, clicks, or moves mouse in MainWindow.
        /// Resets the idle timer and dismisses the idle center mascot if active.
        /// </summary>
        public void NotifyUserActivity()
        {
            _lastUserActivity = DateTime.UtcNow;

            if (_isIdleMascotActive && _activeIdleMascot != null)
            {
                DismissIdleMascot();
            }
        }

        private void IdleCheckTimer_Tick(object? sender, EventArgs e)
        {
            if (_isSailingInProgress) return;

            // Accurate physical input idle detection across WebView2, documents, keyboard & mouse
            double systemIdleSeconds = GetSystemIdleSeconds();
            double appIdleSeconds = (DateTime.UtcNow - _lastUserActivity).TotalSeconds;
            double effectiveIdleSeconds = Math.Min(systemIdleSeconds, appIdleSeconds);

            // If user just interacted, dismiss idle mascot immediately
            if (effectiveIdleSeconds < 5.0 && _isIdleMascotActive)
            {
                DismissIdleMascot();
                return;
            }

            // Shane: "2-4 minutes no mouse movement or typing .... bring him out."
            // 150 seconds = 2.5 minutes of absolute zero input
            if (effectiveIdleSeconds >= 150 && !_isIdleMascotActive && StageWidth > 200 && StageHeight > 200)
            {
                SpawnIdleCenterMascot();
            }
        }

        /// <summary>
        /// Public trigger for builds / events / hotkey (Ctrl+Shift+D).
        /// </summary>
        public void TriggerCelebration(string? customQuote = null)
        {
            string quote = customQuote ?? CelebrationQuips[Rng.Next(CelebrationQuips.Length)];
            SailAcrossScreen(quote: quote, isCelebration: true);
        }

        public void SummonMascot()
        {
            SailAcrossScreen(quote: SailorQuips[Rng.Next(SailorQuips.Length)], isCelebration: false);
        }

        // ══════════════════════════════════════════════════════════════════════
        // 1. SAIL ACROSS SCREEN ANIMATION
        // ══════════════════════════════════════════════════════════════════════
        public void SailAcrossScreen(string? quote = null, bool isCelebration = false, double? targetY = null)
        {
            if (StageWidth < 100 || StageHeight < 100) return;

            _isSailingInProgress = true;
            bool leftToRight = Rng.NextDouble() < 0.65; // Mostly left-to-right as specified

            // Shane: "make donald WAAAAY bigger" — scaled to 240x240 for large, glorious screen presence!
            double mascotSize = 240;
            var mascot = CreateSailorDuckInSailboat(mascotSize, mascotSize, showSpeechBubble: quote != null, speechText: quote);

            // Position vertically: middle or lower third with variance
            double y = targetY ?? (StageHeight * 0.45 + Rng.Next(-50, (int)Math.Max(10, StageHeight * 0.25 - 60)));
            if (y > StageHeight - mascotSize - 50) y = StageHeight - mascotSize - 50;
            if (y < 50) y = 50;

            double startX = leftToRight ? -mascotSize - 40 : StageWidth + 40;
            double endX = leftToRight ? StageWidth + 40 : -mascotSize - 40;

            Canvas.SetLeft(mascot, startX);
            Canvas.SetTop(mascot, y);

            // Flip facing if moving right-to-left
            if (!leftToRight)
            {
                if (mascot.RenderTransform is TransformGroup tg)
                {
                    var scale = new ScaleTransform(-1, 1, mascotSize / 2, mascotSize / 2);
                    tg.Children.Add(scale);
                }
            }

            TargetMascotCanvas.Children.Add(mascot);

            // Click interaction on moving mascot
            mascot.MouseLeftButtonDown += (s, e) =>
            {
                e.Handled = true;
                PlayQuackHop(mascot);
                SpawnSparkles(new Point(Canvas.GetLeft(mascot) + mascotSize / 2, Canvas.GetTop(mascot) + mascotSize / 2));
            };

            double durationSeconds = isCelebration ? 8.5 : (10.0 + Rng.NextDouble() * 3.0);

            // Horizontal glide
            var xAnim = new DoubleAnimation(startX, endX, TimeSpan.FromSeconds(durationSeconds))
            {
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };

            // Wave bobbing (up and down water wave bounce)
            var bobTransform = new TranslateTransform();
            var tiltTransform = new RotateTransform(0, mascotSize / 2, mascotSize * 0.85);

            if (mascot.RenderTransform is TransformGroup group)
            {
                group.Children.Add(bobTransform);
                group.Children.Add(tiltTransform);
            }
            else
            {
                var newGroup = new TransformGroup();
                newGroup.Children.Add(bobTransform);
                newGroup.Children.Add(tiltTransform);
                mascot.RenderTransform = newGroup;
            }

            var bobAnim = new DoubleAnimation(-11, 11, TimeSpan.FromSeconds(0.8))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            bobTransform.BeginAnimation(TranslateTransform.YProperty, bobAnim);

            // Gentle boat rocking on the waves
            var tiltAnim = new DoubleAnimation(-6, 6, TimeSpan.FromSeconds(1.2))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            tiltTransform.BeginAnimation(RotateTransform.AngleProperty, tiltAnim);

            if (isCelebration)
            {
                SpawnCelebrationConfetti();
            }

            xAnim.Completed += (_, _) =>
            {
                TargetMascotCanvas.Children.Remove(mascot);
                _isSailingInProgress = false;
            };

            mascot.BeginAnimation(Canvas.LeftProperty, xAnim);
        }

        // ══════════════════════════════════════════════════════════════════════
        // 2. IDLE CENTER STAGE MASCOT (DROPS ANCHOR IN CENTER)
        // ══════════════════════════════════════════════════════════════════════
        private void SpawnIdleCenterMascot()
        {
            _isIdleMascotActive = true;
            // Shane: "make donald WAAAAY bigger" — 320x320 large center-screen anchor drop
            double mascotSize = 320;

            double targetX = (StageWidth - mascotSize) / 2;
            double targetY = (StageHeight - mascotSize) / 2 + 10;

            var mascot = CreateSailorDuckInSailboat(
                mascotSize, mascotSize,
                showSpeechBubble: true,
                speechText: "Quack! Taking a breather? ⚓ Zzz...",
                isDroppingAnchor: true);

            _activeIdleMascot = mascot;

            // Start off-screen from the left and sail to center
            Canvas.SetLeft(mascot, -mascotSize - 30);
            Canvas.SetTop(mascot, targetY);
            TargetMascotCanvas.Children.Add(mascot);

            // Click interaction
            mascot.MouseLeftButtonDown += (s, e) =>
            {
                e.Handled = true;
                PlayQuackHop(mascot);
                SpawnSparkles(new Point(Canvas.GetLeft(mascot) + mascotSize / 2, Canvas.GetTop(mascot) + mascotSize / 2));
            };

            // Glide to center
            var enterAnim = new DoubleAnimation(-mascotSize - 30, targetX, TimeSpan.FromSeconds(3.5))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            };

            var bobTransform = new TranslateTransform();
            var tiltTransform = new RotateTransform(0, mascotSize / 2, mascotSize * 0.85);

            var group = new TransformGroup();
            group.Children.Add(bobTransform);
            group.Children.Add(tiltTransform);
            mascot.RenderTransform = group;

            var bobAnim = new DoubleAnimation(-5, 5, TimeSpan.FromSeconds(1.0))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            bobTransform.BeginAnimation(TranslateTransform.YProperty, bobAnim);

            var tiltAnim = new DoubleAnimation(-3, 3, TimeSpan.FromSeconds(1.4))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            tiltTransform.BeginAnimation(RotateTransform.AngleProperty, tiltAnim);

            mascot.BeginAnimation(Canvas.LeftProperty, enterAnim);
        }

        private void DismissIdleMascot()
        {
            if (_activeIdleMascot == null) return;

            var mascot = _activeIdleMascot;
            _activeIdleMascot = null;
            _isIdleMascotActive = false;

            double currentX = Canvas.GetLeft(mascot);
            double exitX = StageWidth + 150;

            var exitAnim = new DoubleAnimation(currentX, exitX, TimeSpan.FromSeconds(2.8))
            {
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseIn }
            };

            exitAnim.Completed += (_, _) =>
            {
                TargetMascotCanvas.Children.Remove(mascot);
            };

            mascot.BeginAnimation(Canvas.LeftProperty, exitAnim);
        }

        // ══════════════════════════════════════════════════════════════════════
        // 3. SAILOR DUCK & SAILBOAT VECTOR VISUAL BUILDER
        // ══════════════════════════════════════════════════════════════════════
        public static Grid CreateSailorDuckInSailboat(
            double width = 120,
            double height = 120,
            bool showSpeechBubble = false,
            string? speechText = null,
            bool isDroppingAnchor = false)
        {
            var root = new Grid
            {
                Width = width,
                Height = height,
                Cursor = Cursors.Hand,
                RenderTransformOrigin = new Point(0.5, 0.5),
                RenderTransform = new TransformGroup()
            };

            var canvas = new Canvas
            {
                Width = 120,
                Height = 120,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };

            // Scale to desired width/height
            if (Math.Abs(width - 120) > 1 || Math.Abs(height - 120) > 1)
            {
                double scaleRatio = width / 120.0;
                canvas.LayoutTransform = new ScaleTransform(scaleRatio, scaleRatio);
            }

            // ── WATER RIPPLES BENEATH SAILBOAT ──
            var rippleBrush = new SolidColorBrush(Color.FromArgb(140, 56, 189, 248)); // #38BDF8
            var ripple1 = new Path
            {
                Data = Geometry.Parse("M 10,104 C 30,108 50,100 70,105 C 90,110 110,102 118,104"),
                Stroke = rippleBrush,
                StrokeThickness = 2.5,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round
            };
            canvas.Children.Add(ripple1);

            var ripple2 = new Path
            {
                Data = Geometry.Parse("M 22,109 C 45,113 75,107 104,110"),
                Stroke = new SolidColorBrush(Color.FromArgb(90, 137, 180, 250)),
                StrokeThickness = 2.0,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round
            };
            canvas.Children.Add(ripple2);

            // ── SAILBOAT: HULL ──
            // White crisp hull with wooden trim rim and navy waterline accent
            var hullGeom = Geometry.Parse("M 16,84 C 20,102 44,106 60,106 C 76,106 100,102 108,84 Z");
            var hullPath = new Path
            {
                Data = hullGeom,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xFA, 0xFA, 0xFA),
                    Color.FromRgb(0xDE, 0xE2, 0xE6),
                    new Point(0, 0),
                    new Point(0, 1)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x64, 0x74, 0x8B)),
                StrokeThickness = 1.8
            };
            canvas.Children.Add(hullPath);

            // Waterline Blue Stripe on Hull
            var stripePath = new Path
            {
                Data = Geometry.Parse("M 22,94 C 36,101 84,101 102,94 C 98,99 82,103 60,103 C 38,103 26,99 22,94 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x1D, 0x4E, 0xD8)) // Navy/Royal
            };
            canvas.Children.Add(stripePath);

            // Hull Rim Wood Gunwale
            var rimPath = new Path
            {
                Data = Geometry.Parse("M 14,84 C 40,86 80,86 110,84 C 110,87 80,89 14,87 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0xB4, 0x53, 0x09)) // Amber wood
            };
            canvas.Children.Add(rimPath);

            // ── SAILBOAT: MAST & SAIL ──
            // Wooden Mast
            var mast = new Rectangle
            {
                Width = 3.5,
                Height = 60,
                RadiusX = 1.5,
                RadiusY = 1.5,
                Fill = new SolidColorBrush(Color.FromRgb(0x78, 0x35, 0x0F))
            };
            Canvas.SetLeft(mast, 66);
            Canvas.SetTop(mast, 26);
            canvas.Children.Add(mast);

            // Triangular Billowy White Sail Catching the Wind
            var sailPath = new Path
            {
                Data = Geometry.Parse("M 67,29 C 88,48 94,68 67,78 C 76,58 74,40 67,29 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xFF, 0xFF, 0xFF),
                    Color.FromRgb(0xE2, 0xE8, 0xF0),
                    new Point(0, 0),
                    new Point(1, 1)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)),
                StrokeThickness = 1.2
            };
            canvas.Children.Add(sailPath);

            // Sail pennant/flag atop mast
            var flagPath = new Path
            {
                Data = Geometry.Parse("M 67,26 L 80,31 L 67,36 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0xEF, 0x44, 0x44)) // Red pennant
            };
            canvas.Children.Add(flagPath);

            // Anchor drop effect (if idle mode)
            if (isDroppingAnchor)
            {
                var anchorChain = new Path
                {
                    Data = Geometry.Parse("M 24,88 C 20,98 18,108 16,118"),
                    Stroke = new SolidColorBrush(Color.FromRgb(0x94, 0xA3, 0xB8)),
                    StrokeThickness = 1.5,
                    StrokeDashArray = new DoubleCollection { 2, 2 }
                };
                canvas.Children.Add(anchorChain);

                var anchorIcon = new TextBlock
                {
                    Text = "⚓",
                    FontSize = 14,
                    Foreground = new SolidColorBrush(Color.FromRgb(0x64, 0x74, 0x8B))
                };
                Canvas.SetLeft(anchorIcon, 8);
                Canvas.SetTop(anchorIcon, 108);
                canvas.Children.Add(anchorIcon);
            }

            // ── SAILOR DUCK: BODY / TUNIC ──
            // Navy blue sailor tunic inside the boat
            var tunicPath = new Path
            {
                Data = Geometry.Parse("M 32,68 C 32,58 56,58 56,68 L 58,85 C 50,88 38,88 30,85 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x1E, 0x3A, 0x8A)), // Dark Navy
                Stroke = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A)),
                StrokeThickness = 1.2
            };
            canvas.Children.Add(tunicPath);

            // White Sailor Collar Trim
            var collarPath = new Path
            {
                Data = Geometry.Parse("M 33,62 L 44,72 L 55,62 L 50,60 L 44,66 L 38,60 Z"),
                Fill = Brushes.White
            };
            canvas.Children.Add(collarPath);

            // Bright Red Neckerchief / Bow Tie
            var bowTie = new Path
            {
                Data = Geometry.Parse("M 44,68 L 38,64 L 38,72 Z M 44,68 L 50,64 L 50,72 Z M 42,66 A 2,2 0 1 0 46,66 A 2,2 0 1 0 42,66 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0xEF, 0x44, 0x44)),
                Stroke = new SolidColorBrush(Color.FromRgb(0xB9, 0x1C, 0x1C)),
                StrokeThickness = 0.8
            };
            canvas.Children.Add(bowTie);

            // ── SAILOR DUCK: HEAD & FEATHERS ──
            // Round White Chibi Duck Head
            var headEllipse = new Ellipse
            {
                Width = 34,
                Height = 32,
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xFF, 0xFF, 0xFF),
                    Color.FromRgb(0xFA, 0xFA, 0xFA),
                    new Point(0, 0),
                    new Point(0, 1)),
                Stroke = new SolidColorBrush(Color.FromRgb(0xCB, 0xD5, 0xE1)),
                StrokeThickness = 1.2
            };
            Canvas.SetLeft(headEllipse, 27);
            Canvas.SetTop(headEllipse, 34);
            canvas.Children.Add(headEllipse);

            // Cute Cheek Blush (Subtle Peach/Pink)
            var blushLeft = new Ellipse
            {
                Width = 7,
                Height = 4,
                Fill = new SolidColorBrush(Color.FromArgb(80, 251, 113, 133))
            };
            Canvas.SetLeft(blushLeft, 29);
            Canvas.SetTop(blushLeft, 49);
            canvas.Children.Add(blushLeft);

            var blushRight = new Ellipse
            {
                Width = 7,
                Height = 4,
                Fill = new SolidColorBrush(Color.FromArgb(80, 251, 113, 133))
            };
            Canvas.SetLeft(blushRight, 51);
            Canvas.SetTop(blushRight, 49);
            canvas.Children.Add(blushRight);

            // ── LARGE EXPRESSIVE GLOSSY CARTOON EYES ──
            // Left Eye White
            var leftEyeWhite = new Ellipse { Width = 8.5, Height = 12, Fill = Brushes.White, Stroke = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B)), StrokeThickness = 1.2 };
            Canvas.SetLeft(leftEyeWhite, 34);
            Canvas.SetTop(leftEyeWhite, 39);
            canvas.Children.Add(leftEyeWhite);

            // Left Pupil (Glossy Dark with White Shine Highlight)
            var leftPupil = new Ellipse { Width = 5.5, Height = 8, Fill = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A)) };
            Canvas.SetLeft(leftPupil, 36);
            Canvas.SetTop(leftPupil, 42);
            canvas.Children.Add(leftPupil);

            var leftShine = new Ellipse { Width = 2.5, Height = 3, Fill = Brushes.White };
            Canvas.SetLeft(leftShine, 37);
            Canvas.SetTop(leftShine, 43);
            canvas.Children.Add(leftShine);

            // Right Eye White
            var rightEyeWhite = new Ellipse { Width = 8.5, Height = 12, Fill = Brushes.White, Stroke = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B)), StrokeThickness = 1.2 };
            Canvas.SetLeft(rightEyeWhite, 45);
            Canvas.SetTop(rightEyeWhite, 39);
            canvas.Children.Add(rightEyeWhite);

            // Right Pupil
            var rightPupil = new Ellipse { Width = 5.5, Height = 8, Fill = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A)) };
            Canvas.SetLeft(rightPupil, 47);
            Canvas.SetTop(rightPupil, 42);
            canvas.Children.Add(rightPupil);

            var rightShine = new Ellipse { Width = 2.5, Height = 3, Fill = Brushes.White };
            Canvas.SetLeft(rightShine, 48);
            Canvas.SetTop(rightShine, 43);
            canvas.Children.Add(rightShine);

            // ── CHEERFUL OPEN ORANGE DUCK BEAK ──
            var beakUpper = new Path
            {
                Data = Geometry.Parse("M 33,48 C 36,44 52,44 55,48 C 58,56 30,56 33,48 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0xFB, 0x92, 0x3C),
                    Color.FromRgb(0xEA, 0x58, 0x0C),
                    new Point(0, 0),
                    new Point(0, 1)),
                Stroke = new SolidColorBrush(Color.FromRgb(0xC2, 0x41, 0x0C)),
                StrokeThickness = 1.1
            };
            canvas.Children.Add(beakUpper);

            // Open Beak Lower Lip & Tongue
            var beakLower = new Path
            {
                Data = Geometry.Parse("M 37,53 C 40,61 48,61 51,53 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x9A, 0x34, 0x12)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x7C, 0x2D, 0x12)),
                StrokeThickness = 1.0
            };
            canvas.Children.Add(beakLower);

            var tongue = new Ellipse
            {
                Width = 6,
                Height = 3.5,
                Fill = new SolidColorBrush(Color.FromRgb(0xF4, 0x72, 0xB6)) // Pink tongue
            };
            Canvas.SetLeft(tongue, 41);
            Canvas.SetTop(tongue, 54.5);
            canvas.Children.Add(tongue);

            // ── OVERSIZED FLOPPY ROYAL BLUE SAILOR CAP ──
            // Trailing Black Ribbons behind cap
            var ribbon1 = new Path
            {
                Data = Geometry.Parse("M 26,36 C 18,40 14,48 10,54 L 14,55 C 18,50 24,42 28,38 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A))
            };
            canvas.Children.Add(ribbon1);

            var ribbon2 = new Path
            {
                Data = Geometry.Parse("M 24,38 C 18,46 16,56 12,62 L 15,63 C 19,57 23,48 27,40 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B))
            };
            canvas.Children.Add(ribbon2);

            // Floppy Blue Cap Dome
            var capDome = new Path
            {
                Data = Geometry.Parse("M 20,32 C 16,18 42,12 56,22 C 62,28 54,36 44,36 C 32,36 24,36 20,32 Z"),
                Fill = new LinearGradientBrush(
                    Color.FromRgb(0x25, 0x63, 0xEB), // Royal Blue
                    Color.FromRgb(0x1D, 0x4E, 0xD8),
                    new Point(0, 0),
                    new Point(1, 1)),
                Stroke = new SolidColorBrush(Color.FromRgb(0x1E, 0x3A, 0x8A)),
                StrokeThickness = 1.3
            };
            canvas.Children.Add(capDome);

            // Cap Black Band with Golden Anchor Detail
            var capBand = new Path
            {
                Data = Geometry.Parse("M 22,32 C 32,36 48,36 56,28 L 54,32 C 46,38 30,38 20,34 Z"),
                Fill = new SolidColorBrush(Color.FromRgb(0x0F, 0x17, 0x2A))
            };
            canvas.Children.Add(capBand);

            var goldBadge = new Ellipse
            {
                Width = 4.5,
                Height = 4.5,
                Fill = new SolidColorBrush(Color.FromRgb(0xFB, 0xBF, 0x24)) // Gold
            };
            Canvas.SetLeft(goldBadge, 37);
            Canvas.SetTop(goldBadge, 30.5);
            canvas.Children.Add(goldBadge);

            // Cute white feather wing resting on boat side / waving
            var wing = new Path
            {
                Data = Geometry.Parse("M 28,70 C 20,74 20,84 26,86 C 30,86 32,78 30,70 Z"),
                Fill = Brushes.White,
                Stroke = new SolidColorBrush(Color.FromRgb(0xCB, 0xD5, 0xE1)),
                StrokeThickness = 1.1
            };
            canvas.Children.Add(wing);

            root.Children.Add(canvas);

            // ── SPEECH BUBBLE OVERLAY ──
            if (showSpeechBubble && !string.IsNullOrEmpty(speechText))
            {
                var bubbleBorder = new Border
                {
                    Background = new SolidColorBrush(Color.FromRgb(0x1E, 0x1E, 0x2E)),
                    BorderBrush = new SolidColorBrush(Color.FromRgb(0x89, 0xB4, 0xFA)),
                    BorderThickness = new Thickness(1.8),
                    CornerRadius = new CornerRadius(10),
                    Padding = new Thickness(12, 6, 12, 6),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Top,
                    Margin = new Thickness(0, -42, 0, 0),
                    Effect = new DropShadowEffect
                    {
                        Color = Colors.Black,
                        Opacity = 0.5,
                        BlurRadius = 12,
                        ShadowDepth = 3
                    }
                };

                var bubbleText = new TextBlock
                {
                    Text = speechText,
                    FontSize = 13.0,
                    FontWeight = FontWeights.Bold,
                    Foreground = new SolidColorBrush(Color.FromRgb(0xCD, 0xD6, 0xF4)),
                    TextWrapping = TextWrapping.NoWrap
                };
                bubbleBorder.Child = bubbleText;
                root.Children.Add(bubbleBorder);
            }

            return root;
        }

        // ══════════════════════════════════════════════════════════════════════
        // 4. CELEBRATION EFFECTS & SPARKLE FOUNTAINS
        // ══════════════════════════════════════════════════════════════════════
        private void PlayQuackHop(FrameworkElement mascot)
        {
            if (mascot.RenderTransform is TransformGroup tg)
            {
                var hop = new TranslateTransform();
                tg.Children.Add(hop);

                var anim = new DoubleAnimation(0, -22, TimeSpan.FromMilliseconds(180))
                {
                    AutoReverse = true,
                    RepeatBehavior = new RepeatBehavior(2),
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                };
                hop.BeginAnimation(TranslateTransform.YProperty, anim);
            }
        }

        public void SpawnSparkles(Point center)
        {
            string[] icons = { "💖", "✨", "⭐", "🦆", "⚓", "🌊" };
            for (int i = 0; i < 7; i++)
            {
                var tb = new TextBlock
                {
                    Text = icons[Rng.Next(icons.Length)],
                    FontSize = 14 + Rng.Next(0, 6)
                };

                Canvas.SetLeft(tb, center.X + Rng.Next(-25, 25));
                Canvas.SetTop(tb, center.Y + Rng.Next(-25, 25));
                TargetFxCanvas.Children.Add(tb);

                double targetY = Canvas.GetTop(tb) - 50 - Rng.Next(10, 40);
                double targetX = Canvas.GetLeft(tb) + Rng.Next(-30, 30);

                var yAnim = new DoubleAnimation(Canvas.GetTop(tb), targetY, TimeSpan.FromSeconds(1.2))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                };
                var fadeAnim = new DoubleAnimation(1.0, 0.0, TimeSpan.FromSeconds(1.2));

                yAnim.Completed += (_, _) => TargetFxCanvas.Children.Remove(tb);

                tb.BeginAnimation(Canvas.TopProperty, yAnim);
                tb.BeginAnimation(OpacityProperty, fadeAnim);
            }
        }

        public void SpawnCelebrationConfetti()
        {
            Color[] colors =
            {
                Color.FromRgb(0xFA, 0xB3, 0x87), // Peach
                Color.FromRgb(0x89, 0xB4, 0xFA), // Blue
                Color.FromRgb(0xA6, 0xE3, 0xA1), // Green
                Color.FromRgb(0xF9, 0xE2, 0xAF), // Yellow
                Color.FromRgb(0xCB, 0xA6, 0xF7), // Mauve
                Color.FromRgb(0xF3, 0x8B, 0xA8)  // Red
            };

            for (int i = 0; i < 28; i++)
            {
                var rect = new Rectangle
                {
                    Width = 6 + Rng.Next(0, 5),
                    Height = 8 + Rng.Next(0, 6),
                    RadiusX = 2,
                    RadiusY = 2,
                    Fill = new SolidColorBrush(colors[Rng.Next(colors.Length)]),
                    RenderTransform = new RotateTransform(Rng.Next(0, 360))
                };

                double startX = Rng.Next(40, (int)Math.Max(60, StageWidth - 40));
                double startY = Rng.Next(10, (int)Math.Max(20, StageHeight * 0.4));

                Canvas.SetLeft(rect, startX);
                Canvas.SetTop(rect, startY);
                TargetFxCanvas.Children.Add(rect);

                var dropAnim = new DoubleAnimation(startY, startY + 180 + Rng.Next(0, 100), TimeSpan.FromSeconds(2.0 + Rng.NextDouble()))
                {
                    EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }
                };
                var fadeAnim = new DoubleAnimation(1.0, 0.0, TimeSpan.FromSeconds(2.5));

                dropAnim.Completed += (_, _) => TargetFxCanvas.Children.Remove(rect);

                rect.BeginAnimation(Canvas.TopProperty, dropAnim);
                rect.BeginAnimation(OpacityProperty, fadeAnim);
            }
        }
    }
}

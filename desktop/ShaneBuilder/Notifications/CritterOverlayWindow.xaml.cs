using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;

namespace ShaneBuilder
{
    /// <summary>
    /// Git #2201 — readme-phase2.md Step 11, Channel 2. Plays one <see cref="Celebration"/> at a
    /// time as a self-removing layer on <c>RootCanvas</c>; several can be layered concurrently (each
    /// owns its own <see cref="Canvas"/> sub-layer and removes only itself). Tier table (count/size)
    /// and the confetti/disco/wash/banner/chip/stamp gating are the mockup's own <c>celebrate()</c>
    /// logic (Shell Skeleton v2.dc.html), ported numerically — see AlertModels.AlertCatalog for the
    /// shared tier tables.
    /// </summary>
    public partial class CritterOverlayWindow : Window
    {
        [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
        [DllImport("user32.dll")] private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

        private const int GwlExStyle = -20;
        private const int WsExTransparent = 0x00000020;
        private const int WsExLayered = 0x00080000;
        private static readonly IntPtr HwndTopmost = new IntPtr(-1);
        private const uint SwpNoMove = 0x0002, SwpNoSize = 0x0001, SwpNoActivate = 0x0010;

        private static readonly string[] ConfettiTones = { "#7c8cf0", "#00b4d8", "#e2b039", "#e2593f", "#7fb08a", "#a374ea", "#f0c9c2" };

        public CritterOverlayWindow()
        {
            InitializeComponent();
            Loaded += (_, _) => { ConfigureForWorkArea(); MakeClickThrough(); };
        }

        private void ConfigureForWorkArea()
        {
            try
            {
                var wa = SystemParameters.WorkArea;
                WindowStartupLocation = WindowStartupLocation.Manual;
                Left = wa.Left; Top = wa.Top; Width = wa.Width; Height = wa.Height;
                RootCanvas.Width = wa.Width; RootCanvas.Height = wa.Height;
            }
            catch { }
        }

        // Real click-through: WPF's own IsHitTestVisible="False" stops WPF-level hit testing but the
        // HWND itself still eats the mouse at the Win32 level unless WS_EX_TRANSPARENT is set — a
        // party would otherwise block clicking the shell underneath it for its whole duration.
        private void MakeClickThrough()
        {
            try
            {
                var hwnd = new WindowInteropHelper(this).Handle;
                if (hwnd == IntPtr.Zero) return;
                int ex = GetWindowLong(hwnd, GwlExStyle);
                SetWindowLong(hwnd, GwlExStyle, ex | WsExTransparent | WsExLayered);
                SetWindowPos(hwnd, HwndTopmost, 0, 0, 0, 0, SwpNoMove | SwpNoSize | SwpNoActivate);
            }
            catch { }
        }

        public void Play(Celebration c)
        {
            try { PlayCore(c); } catch { /* a celebration failing must never crash the emitter */ }
        }

        private void PlayCore(Celebration c)
        {
            int tier = Math.Clamp(c.Tier, 1, 5);
            int idx = tier - 1;
            int count = AlertCatalog.TierCount[idx];
            int size = AlertCatalog.TierSize[idx];
            bool good = c.Mood == Mood.Good;
            bool confetti = good && tier >= 2;
            bool disco = good && tier >= 3;
            bool wash = !good;
            bool banner = good && tier >= 3;
            bool chip = c.Shape == CelebrationShape.Eat || c.Shape == CelebrationShape.Carry;
            bool stamp = c.Shape == CelebrationShape.Whammy;
            bool back = c.Shape == CelebrationShape.Carry;
            double durMs = 3200 + tier * 500;

            if (!IsVisible) { try { Show(); } catch { } }
            ConfigureForWorkArea();
            MakeClickThrough();

            double w = Math.Max(RootCanvas.Width, 400);
            double h = Math.Max(RootCanvas.Height, 300);

            var layer = new Canvas { Width = w, Height = h, IsHitTestVisible = false };
            RootCanvas.Children.Add(layer);

            if (wash) AddWash(layer, w, h, tier);
            if (disco) AddDisco(layer, w, h);
            if (confetti) AddConfetti(layer, w, h, tier);
            AddCritters(layer, w, h, count, size, c.Mood, back);
            if (banner) AddBanner(layer, w, tier, c.Label ?? c.Text);
            if (chip) AddChip(layer, w, h, c.Text, c.Shape == CelebrationShape.Carry, durMs);
            if (stamp) AddStamp(layer, w, h, c.Text, durMs);

            _ = RemoveAfter(layer, durMs + 400);
        }

        private async Task RemoveAfter(Canvas layer, double ms)
        {
            await Task.Delay(TimeSpan.FromMilliseconds(ms));
            try
            {
                RootCanvas.Children.Remove(layer);
                if (RootCanvas.Children.Count == 0) Hide();
            }
            catch { }
        }

        // ── Wash — bad news gets a deepening red radial wash instead of confetti ──────────────
        private static void AddWash(Canvas layer, double w, double h, int tier)
        {
            double opacity = 0.06 + tier * 0.05;
            var brush = new RadialGradientBrush();
            brush.GradientStops.Add(new GradientStop(Color.FromArgb((byte)(opacity * 255), 226, 89, 63), 0));
            brush.GradientStops.Add(new GradientStop(Color.FromArgb((byte)(opacity * 0.3 * 255), 226, 89, 63), 0.6));
            brush.GradientStops.Add(new GradientStop(Colors.Transparent, 0.78));
            var rect = new Rectangle { Width = w, Height = h, Fill = brush, IsHitTestVisible = false };
            Canvas.SetLeft(rect, 0); Canvas.SetTop(rect, 0);
            layer.Children.Add(rect);
        }

        // ── Disco — three drifting radial blobs, gated on good news tier >= 3 ─────────────────
        private static void AddDisco(Canvas layer, double w, double h)
        {
            AddDiscoBlob(layer, w, h, 0.60, -0.10, -0.20, Color.FromRgb(124, 140, 240), 1.6, 0);
            AddDiscoBlob(layer, w, h, 0.52, 0.92, 0.10, Color.FromRgb(0, 180, 216), 2.1, 0.3);
            AddDiscoBlob(layer, w, h, 0.46, 0.22, -0.16, Color.FromRgb(226, 176, 57), 1.9, 0.15);
        }

        private static void AddDiscoBlob(Canvas layer, double w, double h, double sizeFrac, double leftFrac, double topFrac, Color color, double periodSec, double delaySec)
        {
            double size = w * sizeFrac;
            var brush = new RadialGradientBrush();
            brush.GradientStops.Add(new GradientStop(Color.FromArgb(140, color.R, color.G, color.B), 0));
            brush.GradientStops.Add(new GradientStop(Colors.Transparent, 0.62));
            var ellipse = new Ellipse { Width = size, Height = size, Fill = brush, IsHitTestVisible = false, Opacity = 0.10 };
            var transform = new TranslateTransform();
            ellipse.RenderTransform = transform;
            Canvas.SetLeft(ellipse, leftFrac * w);
            Canvas.SetTop(ellipse, topFrac * h);
            layer.Children.Add(ellipse);

            var opacityAnim = new DoubleAnimationUsingKeyFrames { BeginTime = TimeSpan.FromSeconds(delaySec), RepeatBehavior = RepeatBehavior.Forever };
            opacityAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0.10, TimeSpan.Zero));
            opacityAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0.40, TimeSpan.FromSeconds(periodSec / 2)));
            opacityAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0.10, TimeSpan.FromSeconds(periodSec)));
            ellipse.BeginAnimation(UIElement.OpacityProperty, opacityAnim);

            var xAnim = new DoubleAnimationUsingKeyFrames { BeginTime = TimeSpan.FromSeconds(delaySec), RepeatBehavior = RepeatBehavior.Forever };
            xAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.Zero));
            xAnim.KeyFrames.Add(new LinearDoubleKeyFrame(w * 0.07, TimeSpan.FromSeconds(periodSec / 2)));
            xAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.FromSeconds(periodSec)));
            transform.BeginAnimation(TranslateTransform.XProperty, xAnim);
        }

        // ── Confetti — fall + spin, gated on good news tier >= 2 ──────────────────────────────
        private static void AddConfetti(Canvas layer, double w, double h, int tier)
        {
            int n = 14 + tier * 8;
            for (int i = 0; i < n; i++)
            {
                double pieceW = 5 + (i % 3) * 3;
                double pieceH = 9 + (i % 4) * 4;
                var color = (Color)ColorConverter.ConvertFromString(ConfettiTones[i % ConfettiTones.Length]);
                var rect = new Rectangle { Width = pieceW, Height = pieceH, Fill = new SolidColorBrush(color), IsHitTestVisible = false, RadiusX = 1, RadiusY = 1 };
                var group = new TransformGroup();
                var rotate = new RotateTransform(0, pieceW / 2, pieceH / 2);
                var translate = new TranslateTransform(0, -0.12 * h);
                group.Children.Add(rotate);
                group.Children.Add(translate);
                rect.RenderTransform = group;
                Canvas.SetLeft(rect, (i * 7.3 % 100) / 100.0 * w);
                Canvas.SetTop(rect, 0);
                layer.Children.Add(rect);

                double durSec = 1.9 + (i % 5) * 0.45;
                double delaySec = (i % 9) * 0.13;
                var yAnim = new DoubleAnimation(-0.12 * h, 1.08 * h, TimeSpan.FromSeconds(durSec)) { BeginTime = TimeSpan.FromSeconds(delaySec), FillBehavior = FillBehavior.HoldEnd };
                translate.BeginAnimation(TranslateTransform.YProperty, yAnim);
                var rotAnim = new DoubleAnimation(0, 760, TimeSpan.FromSeconds(durSec)) { BeginTime = TimeSpan.FromSeconds(delaySec), FillBehavior = FillBehavior.HoldEnd };
                rotate.BeginAnimation(RotateTransform.AngleProperty, rotAnim);
                var opAnim = new DoubleAnimation(1, 0.85, TimeSpan.FromSeconds(durSec)) { BeginTime = TimeSpan.FromSeconds(delaySec), FillBehavior = FillBehavior.HoldEnd };
                rect.BeginAnimation(UIElement.OpacityProperty, opAnim);
            }
        }

        // ── Critters — run across (cheer/party/whammy) or trudge in backward (carry) ──────────
        private static void AddCritters(Canvas layer, double w, double h, int count, int size, Mood mood, bool back)
        {
            var pool = CritterRegistry.All.Where(c => c.Category == (mood == Mood.Evil ? CritterCategory.Negative : CritterCategory.Positive)).ToList();
            if (pool.Count == 0) return;

            for (int i = 0; i < count; i++)
            {
                var info = pool[(i * 3 + count) % pool.Count];
                double critterSize = size + (i % 3) * 5;
                double topFrac = (12 + (i * 13) % 62) / 100.0;
                double runDurSec = (back ? 4.4 : 2.8) + (i % 4) * 0.35;
                double delaySec = i * 0.16;
                double bobDurSec = 0.44 + (i % 3) * 0.09;

                Canvas art;
                try { art = info.Factory(); } catch { continue; }
                var viewbox = new Viewbox { Width = critterSize, Height = critterSize, Child = art, IsHitTestVisible = false };
                viewbox.Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 14, ShadowDepth = 6, Opacity = 0.5, Color = Colors.Black };

                var bobGroup = new TransformGroup();
                var bobTranslate = new TranslateTransform();
                var bobRotate = new RotateTransform(0, critterSize / 2, critterSize / 2);
                bobGroup.Children.Add(bobRotate);
                bobGroup.Children.Add(bobTranslate);
                viewbox.RenderTransform = bobGroup;

                var runTranslate = new TranslateTransform(back ? w + critterSize : -critterSize, 0);
                var wrap = new Canvas { Width = critterSize, Height = critterSize, RenderTransform = runTranslate, IsHitTestVisible = false };
                wrap.Children.Add(viewbox);
                Canvas.SetTop(wrap, topFrac * h);
                Canvas.SetLeft(wrap, 0);
                layer.Children.Add(wrap);

                var runAnim = new DoubleAnimation(
                    back ? w + critterSize : -critterSize,
                    back ? -critterSize : w + critterSize,
                    TimeSpan.FromSeconds(runDurSec))
                { BeginTime = TimeSpan.FromSeconds(delaySec), FillBehavior = FillBehavior.HoldEnd };
                runTranslate.BeginAnimation(TranslateTransform.XProperty, runAnim);

                double bobRange = mood == Mood.Evil ? 4 : 16;
                double rotRange = mood == Mood.Evil ? 3 : 5;
                var bobAnim = new DoubleAnimationUsingKeyFrames { BeginTime = TimeSpan.FromSeconds(delaySec), RepeatBehavior = RepeatBehavior.Forever };
                bobAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.Zero));
                bobAnim.KeyFrames.Add(new LinearDoubleKeyFrame(-bobRange, TimeSpan.FromSeconds(bobDurSec / 2)));
                bobAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.FromSeconds(bobDurSec)));
                bobTranslate.BeginAnimation(TranslateTransform.YProperty, bobAnim);

                var rotAnim = new DoubleAnimationUsingKeyFrames { BeginTime = TimeSpan.FromSeconds(delaySec), RepeatBehavior = RepeatBehavior.Forever };
                rotAnim.KeyFrames.Add(new LinearDoubleKeyFrame(-rotRange, TimeSpan.Zero));
                rotAnim.KeyFrames.Add(new LinearDoubleKeyFrame(rotRange, TimeSpan.FromSeconds(bobDurSec / 2)));
                rotAnim.KeyFrames.Add(new LinearDoubleKeyFrame(-rotRange, TimeSpan.FromSeconds(bobDurSec)));
                bobRotate.BeginAnimation(RotateTransform.AngleProperty, rotAnim);
            }
        }

        // ── Banner — tier >= 3 good news: "TIER N" + label, slides down from the top ──────────
        private static void AddBanner(Canvas layer, double w, int tier, string label)
        {
            var border = new Border
            {
                Padding = new Thickness(30, 14, 30, 14),
                CornerRadius = new CornerRadius(12),
                Background = new SolidColorBrush(Color.FromArgb(240, 22, 27, 34)),
                BorderBrush = new SolidColorBrush(Color.FromArgb(128, 124, 140, 240)),
                BorderThickness = new Thickness(1),
                IsHitTestVisible = false,
            };
            border.Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 40, ShadowDepth = 8, Opacity = 0.6, Color = Colors.Black };
            var stack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
            stack.Children.Add(new TextBlock
            {
                Text = $"TIER {tier}",
                FontFamily = new FontFamily("Consolas"),
                FontSize = 11, FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Color.FromRgb(124, 140, 240)),
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            stack.Children.Add(new TextBlock
            {
                Text = label,
                FontSize = 18, FontWeight = FontWeights.Bold,
                Foreground = Brushes.White,
                Margin = new Thickness(0, 4, 0, 0),
                HorizontalAlignment = HorizontalAlignment.Center,
            });
            border.Child = stack;

            border.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            double bw = Math.Max(border.DesiredSize.Width, 200);
            Canvas.SetLeft(border, (w - bw) / 2);
            Canvas.SetTop(border, 40);

            var translate = new TranslateTransform(0, -44);
            border.RenderTransform = translate;
            border.Opacity = 0;
            layer.Children.Add(border);

            var opAnim = new DoubleAnimationUsingKeyFrames();
            opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.Zero));
            opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1, TimeSpan.FromMilliseconds(400)));
            opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1, TimeSpan.FromMilliseconds(3000)));
            opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.FromMilliseconds(3400)));
            border.BeginAnimation(UIElement.OpacityProperty, opAnim);

            var yAnim = new DoubleAnimationUsingKeyFrames();
            yAnim.KeyFrames.Add(new LinearDoubleKeyFrame(-44, TimeSpan.Zero));
            yAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.FromMilliseconds(400)));
            border.BeginAnimation(TranslateTransform.YProperty, yAnim);
        }

        // ── Chip — "eat" (issue closed: munches away) / "carry" (issue opened: trudges in) ────
        private static void AddChip(Canvas layer, double w, double h, string text, bool carry, double durMs)
        {
            var evil = carry;
            var border = new Border
            {
                Padding = new Thickness(16, 10, 16, 10),
                CornerRadius = new CornerRadius(10),
                Background = new SolidColorBrush(Color.FromArgb(40, evil ? (byte)226 : (byte)127, evil ? (byte)89 : (byte)176, evil ? (byte)63 : (byte)138)),
                BorderBrush = new SolidColorBrush(Color.FromArgb(128, evil ? (byte)226 : (byte)127, evil ? (byte)89 : (byte)176, evil ? (byte)63 : (byte)138)),
                BorderThickness = new Thickness(1),
                IsHitTestVisible = false,
            };
            border.Child = new TextBlock
            {
                Text = text,
                FontFamily = new FontFamily("Consolas"),
                FontSize = 20, FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(evil ? Color.FromRgb(240, 169, 156) : Color.FromRgb(159, 208, 169)),
            };
            border.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            Canvas.SetLeft(border, (w - border.DesiredSize.Width) / 2);
            Canvas.SetTop(border, h / 2 - 30);
            layer.Children.Add(border);

            if (evil)
            {
                // carry: appears with the critters and just sits (position tracks nothing specific
                // here — the critters themselves carry the visual weight); a small settle-in fade.
                border.Opacity = 0;
                border.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(500)) { BeginTime = TimeSpan.FromMilliseconds(300) });
            }
            else
            {
                // eat: munched away — scale up slightly then shrink to nothing.
                double munchAtMs = Math.Max(200, durMs - 900);
                var scaleTransform = new ScaleTransform(1, 1, border.DesiredSize.Width / 2, border.DesiredSize.Height / 2);
                border.RenderTransform = scaleTransform;
                var scaleAnim = new DoubleAnimationUsingKeyFrames { BeginTime = TimeSpan.FromMilliseconds(munchAtMs) };
                scaleAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1, TimeSpan.Zero));
                scaleAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1.14, TimeSpan.FromMilliseconds(270)));
                scaleAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.FromMilliseconds(900)));
                scaleTransform.BeginAnimation(ScaleTransform.ScaleXProperty, scaleAnim);
                scaleTransform.BeginAnimation(ScaleTransform.ScaleYProperty, scaleAnim);
                var opAnim = new DoubleAnimationUsingKeyFrames { BeginTime = TimeSpan.FromMilliseconds(munchAtMs) };
                opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1, TimeSpan.Zero));
                opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0.6, TimeSpan.FromMilliseconds(630)));
                opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.FromMilliseconds(900)));
                border.BeginAnimation(UIElement.OpacityProperty, opAnim);
            }
        }

        // ── Stamp — "whammy" (blocked, NO confetti): a red stamp slamming down ─────────────────
        private static void AddStamp(Canvas layer, double w, double h, string text, double durMs)
        {
            var border = new Border
            {
                Padding = new Thickness(26, 12, 26, 12),
                BorderThickness = new Thickness(4),
                BorderBrush = new SolidColorBrush(Color.FromRgb(226, 89, 63)),
                Background = new SolidColorBrush(Color.FromArgb(26, 226, 89, 63)),
                CornerRadius = new CornerRadius(10),
                IsHitTestVisible = false,
            };
            border.Child = new TextBlock
            {
                Text = string.IsNullOrWhiteSpace(text) ? "WHAMMY" : text.ToUpperInvariant(),
                FontSize = 34, FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Color.FromRgb(226, 89, 63)),
            };
            border.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            Canvas.SetLeft(border, (w - border.DesiredSize.Width) / 2);
            Canvas.SetTop(border, h / 2 - 60);

            var group = new TransformGroup();
            var rotate = new RotateTransform(-9, border.DesiredSize.Width / 2, border.DesiredSize.Height / 2);
            var scale = new ScaleTransform(2.6, 2.6, border.DesiredSize.Width / 2, border.DesiredSize.Height / 2);
            group.Children.Add(scale);
            group.Children.Add(rotate);
            border.RenderTransform = group;
            border.Opacity = 0;
            layer.Children.Add(border);

            var scaleAnim = new DoubleAnimationUsingKeyFrames();
            scaleAnim.KeyFrames.Add(new LinearDoubleKeyFrame(2.6, TimeSpan.Zero));
            scaleAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1, TimeSpan.FromMilliseconds(durMs * 0.22)));
            scaleAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1, TimeSpan.FromMilliseconds(durMs * 0.78)));
            scaleAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1.14, TimeSpan.FromMilliseconds(durMs)));
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, scaleAnim);
            scale.BeginAnimation(ScaleTransform.ScaleYProperty, scaleAnim);

            var opAnim = new DoubleAnimationUsingKeyFrames();
            opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.Zero));
            opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1, TimeSpan.FromMilliseconds(durMs * 0.22)));
            opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(1, TimeSpan.FromMilliseconds(durMs * 0.78)));
            opAnim.KeyFrames.Add(new LinearDoubleKeyFrame(0, TimeSpan.FromMilliseconds(durMs)));
            border.BeginAnimation(UIElement.OpacityProperty, opAnim);
        }
    }
}

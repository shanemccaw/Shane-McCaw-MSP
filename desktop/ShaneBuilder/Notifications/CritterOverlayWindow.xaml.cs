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

            // Git #2235 — tier 4 (milestone closed) gets the ported BuildConsole
            // IssueChompAnimation.PlayMilestoneClosedParty mega-celebration instead of the generic
            // tier-scaled effects below: full-screen dark overlay, disco spotlights, giant trophy
            // banner, dancing critters, confetti cannon waves, balloons, fireworks, streamers.
            if (tier >= 4 && good && c.Shape == CelebrationShape.Party)
            {
                PlayMegaParty(layer, w, h, c.Label ?? c.Text);
                _ = RemoveAfter(layer, 6600);
                return;
            }

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

        // ══════════════════════════════════════════════════════════════════════════════════════
        // Git #2235 — MILESTONE CLOSED MEGA PARTY. Ported from BuildConsole's
        // Services/IssueChompAnimation.cs ("5. MILESTONE CLOSED PARTY" /
        // PlayMilestoneClosedParty) — same visual sequence (full-screen dark overlay, disco
        // spotlights, giant golden trophy banner, dancing critters, confetti cannon waves, rising
        // balloons, firework starbursts, falling streamers), reusing ShaneBuilder's own
        // CritterRegistry pool in place of BuildConsole's BuildMascot. Not a redesign.
        // ══════════════════════════════════════════════════════════════════════════════════════
        private static readonly Random MegaRng = new();

        private static readonly Color[] MegaConfettiColors =
        {
            Color.FromRgb(0x7c, 0x8c, 0xf0), Color.FromRgb(0x00, 0xb4, 0xd8), Color.FromRgb(0xe2, 0xb0, 0x39),
            Color.FromRgb(0xe2, 0x59, 0x3f), Color.FromRgb(0x7f, 0xb0, 0x8a), Color.FromRgb(0xa3, 0x74, 0xea),
            Color.FromRgb(0xf0, 0xc9, 0xc2),
        };

        private static readonly string[] MegaPartyPhrases =
        {
            "🎉 WE DID IT!", "🏆 LEGENDARY!", "🥳 PARTY TIME!", "🎊 ABSOLUTE UNIT!",
            "✨ HALL OF FAME!", "💎 PERFECTION!", "🔥 UNSTOPPABLE!", "👑 CROWNED!",
        };

        private void PlayMegaParty(Canvas layer, double w, double h, string milestoneTitle)
        {
            // ── 0. Full-screen dark overlay, fade in ──
            var overlay = new Border
            {
                Width = w,
                Height = h,
                Background = new SolidColorBrush(Color.FromArgb(0xCC, 0x11, 0x11, 0x1B)),
                Opacity = 0,
                IsHitTestVisible = false,
            };
            layer.Children.Add(overlay);
            overlay.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(400)));

            // ── 1. Disco / party lights — rotating color washes ──
            for (int li = 0; li < 6; li++)
            {
                var lightColor = MegaConfettiColors[li % MegaConfettiColors.Length];
                var spotlight = new Ellipse
                {
                    Width = 350 + MegaRng.Next(200),
                    Height = 350 + MegaRng.Next(200),
                    Fill = new RadialGradientBrush(Color.FromArgb(0x55, lightColor.R, lightColor.G, lightColor.B), Colors.Transparent),
                    Opacity = 0,
                    IsHitTestVisible = false,
                };
                Canvas.SetLeft(spotlight, MegaRng.Next(0, Math.Max(1, (int)w - 200)));
                Canvas.SetTop(spotlight, MegaRng.Next(0, Math.Max(1, (int)h - 200)));
                layer.Children.Add(spotlight);

                var lightPulse = new DoubleAnimation(0, 0.7, TimeSpan.FromMilliseconds(600 + MegaRng.Next(400)))
                {
                    AutoReverse = true,
                    RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(7000)),
                    BeginTime = TimeSpan.FromMilliseconds(200 + li * 180),
                };
                spotlight.BeginAnimation(UIElement.OpacityProperty, lightPulse);

                var driftTrans = new TranslateTransform();
                spotlight.RenderTransform = driftTrans;
                var lightDrift = new DoubleAnimation(0, MegaRng.Next(-80, 80), TimeSpan.FromMilliseconds(3000 + MegaRng.Next(2000)))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                };
                driftTrans.BeginAnimation(TranslateTransform.XProperty, lightDrift);
            }

            // ── 2. Giant golden trophy banner (center) ──
            var bannerBorder = new Border
            {
                Background = new LinearGradientBrush(Color.FromRgb(0xF9, 0xE2, 0xAF), Color.FromRgb(0xDF, 0x8E, 0x1D), new Point(0, 0), new Point(1, 1)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(0xFF, 0xD7, 0x00)),
                BorderThickness = new Thickness(3),
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(30, 16, 30, 16),
                Opacity = 0,
                RenderTransformOrigin = new Point(0.5, 0.5),
                IsHitTestVisible = false,
                Effect = new System.Windows.Media.Effects.DropShadowEffect { Color = Color.FromRgb(0xFF, 0xD7, 0x00), BlurRadius = 40, ShadowDepth = 0, Opacity = 0.9 },
            };
            var bannerScale = new ScaleTransform(0.1, 0.1);
            bannerBorder.RenderTransform = bannerScale;
            var bannerStack = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center };
            bannerStack.Children.Add(new TextBlock { Text = "🏆", FontSize = 42, HorizontalAlignment = HorizontalAlignment.Center });
            bannerStack.Children.Add(new TextBlock
            {
                Text = "MILESTONE CLOSED!", FontSize = 22, FontWeight = FontWeights.Black,
                Foreground = new SolidColorBrush(Color.FromRgb(0x11, 0x11, 0x1B)), HorizontalAlignment = HorizontalAlignment.Center,
            });
            bannerStack.Children.Add(new TextBlock
            {
                Text = milestoneTitle.Length > 40 ? milestoneTitle.Substring(0, 37) + "…" : milestoneTitle,
                FontSize = 16, FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Color.FromArgb(0xCC, 0x11, 0x11, 0x1B)),
                HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 4, 0, 0),
            });
            bannerStack.Children.Add(new TextBlock
            {
                Text = MegaPartyPhrases[MegaRng.Next(MegaPartyPhrases.Length)],
                FontSize = 14, FontWeight = FontWeights.SemiBold,
                Foreground = new SolidColorBrush(Color.FromArgb(0xAA, 0x11, 0x11, 0x1B)),
                HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 6, 0, 0),
            });
            bannerBorder.Child = bannerStack;

            bannerBorder.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            double bw = bannerBorder.DesiredSize.Width;
            Canvas.SetLeft(bannerBorder, (w - bw) / 2);
            Canvas.SetTop(bannerBorder, h * 0.18);
            layer.Children.Add(bannerBorder);

            bannerBorder.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200)) { BeginTime = TimeSpan.FromMilliseconds(300) });
            var bannerPop = new DoubleAnimation(0.1, 1.1, TimeSpan.FromMilliseconds(500))
            {
                BeginTime = TimeSpan.FromMilliseconds(300),
                EasingFunction = new ElasticEase { Oscillations = 2, Springiness = 4 },
            };
            bannerScale.BeginAnimation(ScaleTransform.ScaleXProperty, bannerPop);
            bannerScale.BeginAnimation(ScaleTransform.ScaleYProperty, bannerPop);

            // ── 3. Dancing critters on stage (real CritterRegistry pool, positive mood) ──
            var pool = CritterRegistry.All.Where(cr => cr.Category == CritterCategory.Positive).ToList();
            if (pool.Count > 0)
            {
                string[] partyEmojis = { "👑", "🎈", "🎉", "🎺", "⭐" };
                double stageY = h * 0.52;
                double stageStartX = (w - 5 * 100) / 2;

                for (int i = 0; i < 5; i++)
                {
                    var info = pool[(i * 3 + MegaRng.Next(pool.Count)) % pool.Count];
                    Canvas critter;
                    try { critter = info.Factory(); } catch { continue; }

                    var decor = new TextBlock { Text = partyEmojis[i % partyEmojis.Length], FontSize = 18, Margin = new Thickness(16, -22, 0, 0) };
                    critter.Children.Add(decor);

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
                    critter.IsHitTestVisible = false;

                    Canvas.SetLeft(critter, posX);
                    Canvas.SetTop(critter, stageY);
                    layer.Children.Add(critter);

                    int delay = 400 + i * 150;

                    var popIn = new DoubleAnimation(60, 0, TimeSpan.FromMilliseconds(400))
                    {
                        BeginTime = TimeSpan.FromMilliseconds(delay),
                        EasingFunction = new BackEase { Amplitude = 0.8, EasingMode = EasingMode.EaseOut },
                    };
                    translateT.BeginAnimation(TranslateTransform.YProperty, popIn);
                    critter.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(200)) { BeginTime = TimeSpan.FromMilliseconds(delay) });

                    var danceY = new DoubleAnimation(0, -20 - MegaRng.Next(15), TimeSpan.FromMilliseconds(250 + MegaRng.Next(150)))
                    {
                        AutoReverse = true, RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(6500)),
                        BeginTime = TimeSpan.FromMilliseconds(delay + 400), EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut },
                    };
                    translateT.BeginAnimation(TranslateTransform.YProperty, danceY);

                    var swayX = new DoubleAnimation(-12, 12, TimeSpan.FromMilliseconds(400 + MegaRng.Next(200)))
                    {
                        AutoReverse = true, RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(6500)), BeginTime = TimeSpan.FromMilliseconds(delay + 500),
                    };
                    translateT.BeginAnimation(TranslateTransform.XProperty, swayX);

                    var squashX = new DoubleAnimation(baseScale, baseScale * 1.15, TimeSpan.FromMilliseconds(200 + MegaRng.Next(100)))
                    {
                        AutoReverse = true, RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(6500)), BeginTime = TimeSpan.FromMilliseconds(delay + 400),
                    };
                    var squashY = new DoubleAnimation(baseScale, baseScale * 0.85, TimeSpan.FromMilliseconds(200 + MegaRng.Next(100)))
                    {
                        AutoReverse = true, RepeatBehavior = new RepeatBehavior(TimeSpan.FromMilliseconds(6500)), BeginTime = TimeSpan.FromMilliseconds(delay + 400),
                    };
                    scaleT.BeginAnimation(ScaleTransform.ScaleXProperty, squashX);
                    scaleT.BeginAnimation(ScaleTransform.ScaleYProperty, squashY);
                }
            }

            // ── 4. Confetti cannon waves ──
            for (int wave = 0; wave < 8; wave++)
            {
                var confettiTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500 + wave * 450) };
                confettiTimer.Tick += (_, _) =>
                {
                    confettiTimer.Stop();
                    double cx = MegaRng.Next(80, Math.Max(81, (int)(w - 80)));
                    double cy = MegaRng.Next(60, Math.Max(61, (int)(h * 0.5)));
                    MegaConfettiBurst(layer, new Point(cx, cy), 40);
                };
                confettiTimer.Start();
            }

            // ── 5. Rising balloons ──
            for (int b = 0; b < 14; b++)
            {
                var balloonTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(300 + b * 200) };
                balloonTimer.Tick += (_, _) => { balloonTimer.Stop(); MegaSpawnBalloon(layer, w, h); };
                balloonTimer.Start();
            }

            // ── 6. Firework starbursts ──
            for (int f = 0; f < 5; f++)
            {
                var fwTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(800 + f * 700) };
                fwTimer.Tick += (_, _) =>
                {
                    fwTimer.Stop();
                    MegaFireworkBurst(layer, new Point(MegaRng.Next(100, Math.Max(101, (int)(w - 100))), MegaRng.Next(60, Math.Max(61, (int)(h * 0.45)))));
                };
                fwTimer.Start();
            }

            // ── 7. Falling streamers ──
            for (int s = 0; s < 20; s++)
            {
                var sTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400 + s * 130) };
                sTimer.Tick += (_, _) => { sTimer.Stop(); MegaSpawnStreamer(layer, w, h); };
                sTimer.Start();
            }

            // ── 8. Fade out ──
            var fadeOutTimer = new System.Windows.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(6200) };
            fadeOutTimer.Tick += (_, _) =>
            {
                fadeOutTimer.Stop();
                layer.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(400)));
            };
            fadeOutTimer.Start();
        }

        private static void MegaConfettiBurst(Canvas canvas, Point center, int particleCount)
        {
            for (int i = 0; i < particleCount; i++)
            {
                double angle = (i / (double)particleCount) * 2 * Math.PI + (MegaRng.NextDouble() * 0.4 - 0.2);
                double speed = MegaRng.Next(60, 220);
                double destX = center.X + Math.Cos(angle) * speed;
                double destY = center.Y + Math.Sin(angle) * speed;

                var p = new Rectangle
                {
                    Width = MegaRng.Next(5, 10), Height = MegaRng.Next(3, 7),
                    Fill = new SolidColorBrush(MegaConfettiColors[MegaRng.Next(MegaConfettiColors.Length)]),
                    RadiusX = 1, RadiusY = 1, IsHitTestVisible = false,
                };
                var trans = new TranslateTransform();
                p.RenderTransform = trans;
                Canvas.SetLeft(p, center.X);
                Canvas.SetTop(p, center.Y);
                canvas.Children.Add(p);

                trans.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(0, destX - center.X, TimeSpan.FromMilliseconds(450)) { EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut } });
                trans.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, destY - center.Y + 30, TimeSpan.FromMilliseconds(600)) { EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut } });
                p.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(500)) { BeginTime = TimeSpan.FromMilliseconds(150) });
            }
        }

        private static void MegaSpawnBalloon(Canvas canvas, double w, double h)
        {
            string[] balloonEmoji = { "🎈", "🎈", "🎈", "🎈", "🟡", "🟣", "🔵", "🟢", "🔴" };
            var balloon = new TextBlock { Text = balloonEmoji[MegaRng.Next(balloonEmoji.Length)], FontSize = 26 + MegaRng.Next(14), Opacity = 0.85, IsHitTestVisible = false };
            Canvas.SetLeft(balloon, MegaRng.Next(30, Math.Max(31, (int)(w - 50))));
            Canvas.SetTop(balloon, h + 20);
            canvas.Children.Add(balloon);

            var riseT = new TranslateTransform();
            balloon.RenderTransform = riseT;
            riseT.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, -(h + 80), TimeSpan.FromMilliseconds(3000 + MegaRng.Next(2000))) { EasingFunction = new SineEase { EasingMode = EasingMode.EaseIn } });
            riseT.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(0, MegaRng.Next(-60, 60), TimeSpan.FromMilliseconds(2500 + MegaRng.Next(1500))) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever });
            balloon.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0.85, 0, TimeSpan.FromMilliseconds(600)) { BeginTime = TimeSpan.FromMilliseconds(2800 + MegaRng.Next(1500)) });
        }

        private static void MegaFireworkBurst(Canvas canvas, Point center)
        {
            int rays = 16 + MegaRng.Next(8);
            var sparkColor = MegaConfettiColors[MegaRng.Next(MegaConfettiColors.Length)];

            for (int r = 0; r < rays; r++)
            {
                double angle = (r / (double)rays) * 2 * Math.PI;
                double speed = 60 + MegaRng.Next(100);
                double destX = center.X + Math.Cos(angle) * speed;
                double destY = center.Y + Math.Sin(angle) * speed;

                var sparkle = new Ellipse { Width = 4 + MegaRng.Next(4), Height = 4 + MegaRng.Next(4), Fill = new SolidColorBrush(sparkColor), IsHitTestVisible = false };
                Canvas.SetLeft(sparkle, center.X);
                Canvas.SetTop(sparkle, center.Y);
                canvas.Children.Add(sparkle);

                var trans = new TranslateTransform();
                sparkle.RenderTransform = trans;
                trans.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(0, destX - center.X, TimeSpan.FromMilliseconds(500 + MegaRng.Next(300))) { EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut } });
                trans.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, destY - center.Y + 30, TimeSpan.FromMilliseconds(600 + MegaRng.Next(300))) { EasingFunction = new CircleEase { EasingMode = EasingMode.EaseOut } });
                sparkle.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(400)) { BeginTime = TimeSpan.FromMilliseconds(300 + MegaRng.Next(200)) });
            }

            var flash = new Ellipse { Width = 30, Height = 30, Fill = new RadialGradientBrush(Colors.White, Colors.Transparent), RenderTransformOrigin = new Point(0.5, 0.5), IsHitTestVisible = false };
            Canvas.SetLeft(flash, center.X - 15);
            Canvas.SetTop(flash, center.Y - 15);
            canvas.Children.Add(flash);

            var flashScale = new ScaleTransform(0.3, 0.3);
            flash.RenderTransform = flashScale;
            flashScale.BeginAnimation(ScaleTransform.ScaleXProperty, new DoubleAnimation(0.3, 3.0, TimeSpan.FromMilliseconds(300)));
            flashScale.BeginAnimation(ScaleTransform.ScaleYProperty, new DoubleAnimation(0.3, 3.0, TimeSpan.FromMilliseconds(300)));
            flash.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(300)));
        }

        private static void MegaSpawnStreamer(Canvas canvas, double w, double h)
        {
            var color = MegaConfettiColors[MegaRng.Next(MegaConfettiColors.Length)];
            double streamerWidth = 4 + MegaRng.Next(5);
            double streamerHeight = 30 + MegaRng.Next(40);

            var streamer = new Border { Width = streamerWidth, Height = streamerHeight, Background = new SolidColorBrush(color), CornerRadius = new CornerRadius(streamerWidth / 2), Opacity = 0.8, IsHitTestVisible = false };
            Canvas.SetLeft(streamer, MegaRng.Next(20, Math.Max(21, (int)(w - 20))));
            Canvas.SetTop(streamer, -streamerHeight);
            canvas.Children.Add(streamer);

            var trans = new TransformGroup();
            var translate = new TranslateTransform();
            var rotate = new RotateTransform(MegaRng.Next(-30, 30));
            trans.Children.Add(rotate);
            trans.Children.Add(translate);
            streamer.RenderTransform = trans;
            streamer.RenderTransformOrigin = new Point(0.5, 0.5);

            translate.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(0, h + streamerHeight + 20, TimeSpan.FromMilliseconds(2500 + MegaRng.Next(2000))) { EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn } });
            translate.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(0, MegaRng.Next(-50, 50), TimeSpan.FromMilliseconds(800 + MegaRng.Next(600))) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever });
            rotate.BeginAnimation(RotateTransform.AngleProperty, new DoubleAnimation(MegaRng.Next(-30, 30), MegaRng.Next(-180, 180), TimeSpan.FromMilliseconds(2000 + MegaRng.Next(1500))));
            streamer.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0.8, 0, TimeSpan.FromMilliseconds(500)) { BeginTime = TimeSpan.FromMilliseconds(2200 + MegaRng.Next(1500)) });
        }
    }
}

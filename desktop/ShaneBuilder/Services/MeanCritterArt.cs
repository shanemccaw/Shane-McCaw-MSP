using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;

namespace ShaneBuilder;

// Ported from desktop/BuildConsole/Services/IssueChompAnimation.MeanCritters.cs for
// Git #2180 — the 10 real Negative critter vector builders (Kilowatt, Dustdevil,
// Sir Blocksalot, Grudge, Wrenchfiend, Doomquack, Snaggletooth, Redtape,
// Bramblebeast, Glitch) plus their shared swing-prop scaffolding. The animation
// choreography (PlayBlocked/PlayNewWork/BuildRandomBlockedElement, which depend on
// Whammy/MoWork and other IssueChompAnimation machinery not present in
// ShaneBuilder) is intentionally NOT ported — out of scope for this issue, which
// delivers the standalone art layer only.
public static class MeanCritterArt
{
    private static Brush M(string hex) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

    /// <summary>One mean mascot's identity + builder — Id/Name for logging, Build for
    /// the full charge-in body + swingable prop.</summary>
    public sealed class MeanCritterInfo
    {
        public string Id { get; init; } = "";
        public string Name { get; init; } = "";
        public Func<(FrameworkElement element, RotateTransform propTransform)> Build { get; init; } = null!;
    }

    // Every mascot below shares Whammy's 74x64 body canvas and its swung-prop slot
    // (a 40x46 sub-canvas at (42,8), pivoting from (8,38)).
    private static (Canvas propCanvas, RotateTransform rot) BuildSwingProp(Action<Canvas> paint)
    {
        var propCanvas = new Canvas { Width = 40, Height = 46 };
        var rot = new RotateTransform(0, 8, 38);
        propCanvas.RenderTransform = rot;
        paint(propCanvas);
        return (propCanvas, rot);
    }

    private static FrameworkElement FinishMascot(Canvas body, Canvas prop)
    {
        Canvas.SetLeft(prop, 42);
        Canvas.SetTop(prop, 8);
        body.Children.Add(prop);
        return body;
    }

    // ── 1. Kilowatt — Stitch-style chaotic blue alien: floppy ears, four stubby arms,
    // wide fanged grin, big mischievous eyes. Swings a frayed, sparking live wire.
    public static (FrameworkElement, RotateTransform) BuildKilowattMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        c.Children.Add(new Path { Fill = M("#1E3A8A"), Data = Geometry.Parse("M 14,26 Q 0,34 8,50 Q 20,46 20,30 Z") });
        c.Children.Add(new Path { Fill = M("#1E3A8A"), Data = Geometry.Parse("M 48,26 Q 62,34 54,50 Q 42,46 42,30 Z") });
        var head = new Ellipse { Width = 42, Height = 38, Fill = M("#3B5FE0") };
        Canvas.SetLeft(head, 12); Canvas.SetTop(head, 16); c.Children.Add(head);
        var armL = new Ellipse { Width = 11, Height = 18, Fill = M("#3B5FE0") };
        Canvas.SetLeft(armL, 6); Canvas.SetTop(armL, 40); c.Children.Add(armL);
        var armR = new Ellipse { Width = 11, Height = 18, Fill = M("#3B5FE0") };
        Canvas.SetLeft(armR, 50); Canvas.SetTop(armR, 40); c.Children.Add(armR);
        c.Children.Add(new Path { Fill = M("#0B0B14"), Data = Geometry.Parse("M 20,40 Q 33,52 46,40 Q 33,46 20,40 Z") });
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(26, 41), new Point(28, 47), new Point(30, 41) }, Fill = Brushes.White });
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(36, 41), new Point(38, 47), new Point(40, 41) }, Fill = Brushes.White });
        var eyeL = new Ellipse { Width = 11, Height = 12, Fill = Brushes.White };
        Canvas.SetLeft(eyeL, 18); Canvas.SetTop(eyeL, 24); c.Children.Add(eyeL);
        var pupilL = new Ellipse { Width = 5.5, Height = 6.5, Fill = M("#0B0B14") };
        Canvas.SetLeft(pupilL, 22); Canvas.SetTop(pupilL, 27); c.Children.Add(pupilL);
        var eyeR = new Ellipse { Width = 11, Height = 12, Fill = Brushes.White };
        Canvas.SetLeft(eyeR, 36); Canvas.SetTop(eyeR, 24); c.Children.Add(eyeR);
        var pupilR = new Ellipse { Width = 5.5, Height = 6.5, Fill = M("#0B0B14") };
        Canvas.SetLeft(pupilR, 40); Canvas.SetTop(pupilR, 27); c.Children.Add(pupilR);

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Path { Stroke = M("#9FB0D9"), StrokeThickness = 2.5, Data = Geometry.Parse("M 8,4 L 8,26 Q 2,32 8,40") });
            pc.Children.Add(new TextBlock { Text = "⚡", FontSize = 16, Foreground = M("#F9E2AF") });
            Canvas.SetLeft(pc.Children[pc.Children.Count - 1], -2); Canvas.SetTop(pc.Children[pc.Children.Count - 1], -6);
        });
        return (FinishMascot(c, prop), rot);
    }

    // ── 2. Dustdevil — Tasmanian-devil-style whirlwind: motion-blur swirl rings, huge
    // fanged mouth, stubby flailing arms. "Swings" its own spinning dust-funnel tail.
    public static (FrameworkElement, RotateTransform) BuildDustdevilMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        for (int i = 0; i < 3; i++)
        {
            var ring = new Ellipse { Width = 54 - i * 12, Height = 22 - i * 5, Stroke = M("#B08968"), StrokeThickness = 1.6, Opacity = 0.55 - i * 0.12 };
            Canvas.SetLeft(ring, 10 + i * 6); Canvas.SetTop(ring, 10 + i * 11);
            c.Children.Add(ring);
        }
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(22, 24), new Point(17, 8), new Point(30, 22) }, Fill = M("#6B4423") });
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(44, 24), new Point(49, 8), new Point(36, 22) }, Fill = M("#6B4423") });
        var body = new Ellipse { Width = 34, Height = 30, Fill = M("#8B5E3C") };
        Canvas.SetLeft(body, 20); Canvas.SetTop(body, 22); c.Children.Add(body);
        c.Children.Add(new Path { Fill = M("#0B0B14"), Data = Geometry.Parse("M 26,38 Q 37,52 48,38 Z") });
        for (int t = 0; t < 4; t++)
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(28 + t * 4.5, 39), new Point(30 + t * 4.5, 45), new Point(32 + t * 4.5, 39) }, Fill = Brushes.White });
        var eyeL = new Ellipse { Width = 6.5, Height = 6.5, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeL, 26); Canvas.SetTop(eyeL, 28); c.Children.Add(eyeL);
        var eyeR = new Ellipse { Width = 6.5, Height = 6.5, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeR, 40); Canvas.SetTop(eyeR, 28); c.Children.Add(eyeR);
        c.Children.Add(new Path { Stroke = M("#8B5E3C"), StrokeThickness = 5.5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Data = Geometry.Parse("M 20,36 Q 4,30 6,18") });
        c.Children.Add(new Path { Stroke = M("#8B5E3C"), StrokeThickness = 5.5, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round, Data = Geometry.Parse("M 54,36 Q 70,30 68,18") });

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Path { Fill = M("#B08968"), Opacity = 0.85, Data = Geometry.Parse("M 8,4 Q 22,10 10,20 Q 20,26 8,34 Q 16,38 8,44 Z") });
        });
        return (FinishMascot(c, prop), rot);
    }

    // ── 3. Sir Blocksalot — a small green gremlin-knight who plants a giant red STOP sign
    // wherever work is trying to happen.
    public static (FrameworkElement, RotateTransform) BuildSirBlocksalotMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        var helm = new Ellipse { Width = 30, Height = 14, Fill = M("#5B6472") };
        Canvas.SetLeft(helm, 18); Canvas.SetTop(helm, 14); c.Children.Add(helm);
        var head = new Ellipse { Width = 32, Height = 30, Fill = M("#6B9B5E") };
        Canvas.SetLeft(head, 17); Canvas.SetTop(head, 20); c.Children.Add(head);
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(17, 26), new Point(9, 20), new Point(19, 18) }, Fill = M("#6B9B5E") });
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(49, 26), new Point(57, 20), new Point(47, 18) }, Fill = M("#6B9B5E") });
        var eyeL = new Ellipse { Width = 6, Height = 7, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeL, 23); Canvas.SetTop(eyeL, 30); c.Children.Add(eyeL);
        var eyeR = new Ellipse { Width = 6, Height = 7, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeR, 38); Canvas.SetTop(eyeR, 30); c.Children.Add(eyeR);
        c.Children.Add(new Path { Stroke = M("#0B0B14"), StrokeThickness = 2, Data = Geometry.Parse("M 24,42 Q 33,38 42,42") });
        var tuskL = new Polygon { Points = new PointCollection { new Point(24, 40), new Point(21, 47), new Point(27, 41) }, Fill = Brushes.Ivory };
        c.Children.Add(tuskL);

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Rectangle { Width = 3, Height = 34, Fill = M("#5B4632") });
            var sign = new Border
            {
                Width = 22,
                Height = 22,
                Background = M("#F38BA8"),
                BorderBrush = Brushes.White,
                BorderThickness = new Thickness(2),
                CornerRadius = new CornerRadius(4)
            };
            sign.Child = new TextBlock { Text = "STOP", FontSize = 6.5, FontWeight = FontWeights.Black, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 6, 0, 0) };
            Canvas.SetLeft(sign, -8); Canvas.SetTop(sign, 0);
            pc.Children.Add(sign);
        });
        return (FinishMascot(c, prop), rot);
    }

    // ── 4. Grudge — a spiky purple porcupine bristling with little red "blocked" flags.
    public static (FrameworkElement, RotateTransform) BuildGrudgeMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        for (int i = 0; i < 7; i++)
        {
            var spike = new Polygon { Points = new PointCollection { new Point(14 + i * 6.5, 22), new Point(17 + i * 6.5, 4), new Point(20 + i * 6.5, 22) }, Fill = M("#7C5CBF") };
            c.Children.Add(spike);
        }
        var body = new Ellipse { Width = 40, Height = 34, Fill = M("#9B7FD4") };
        Canvas.SetLeft(body, 14); Canvas.SetTop(body, 20); c.Children.Add(body);
        var muzzle = new Ellipse { Width = 16, Height = 12, Fill = M("#E0D4F7") };
        Canvas.SetLeft(muzzle, 26); Canvas.SetTop(muzzle, 36); c.Children.Add(muzzle);
        var eyeL = new Ellipse { Width = 5.5, Height = 6.5, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeL, 22); Canvas.SetTop(eyeL, 30); c.Children.Add(eyeL);
        var eyeR = new Ellipse { Width = 5.5, Height = 6.5, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeR, 40); Canvas.SetTop(eyeR, 30); c.Children.Add(eyeR);
        c.Children.Add(new Path { Stroke = M("#3D2E5C"), StrokeThickness = 2, Data = Geometry.Parse("M 20,26 L 27,29 M 48,26 L 41,29") });
        var nose = new Ellipse { Width = 4, Height = 3, Fill = M("#0B0B14") };
        Canvas.SetLeft(nose, 32); Canvas.SetTop(nose, 40); c.Children.Add(nose);

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Rectangle { Width = 2.5, Height = 30, Fill = M("#5B4632") });
            for (int i = 0; i < 3; i++)
            {
                var flag = new Polygon { Points = new PointCollection { new Point(2.5, 2 + i * 8), new Point(16, 5 + i * 8), new Point(2.5, 8 + i * 8) }, Fill = M("#F38BA8") };
                pc.Children.Add(flag);
            }
        });
        return (FinishMascot(c, prop), rot);
    }

    // ── 5. Wrenchfiend — a masked bandit raccoon who "borrows" the tools mid-build.
    public static (FrameworkElement, RotateTransform) BuildWrenchfiendMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        var earL = new Ellipse { Width = 12, Height = 12, Fill = M("#5B5B66") };
        Canvas.SetLeft(earL, 16); Canvas.SetTop(earL, 12); c.Children.Add(earL);
        var earR = new Ellipse { Width = 12, Height = 12, Fill = M("#5B5B66") };
        Canvas.SetLeft(earR, 46); Canvas.SetTop(earR, 12); c.Children.Add(earR);
        var head = new Ellipse { Width = 36, Height = 30, Fill = M("#7A7A87") };
        Canvas.SetLeft(head, 16); Canvas.SetTop(head, 18); c.Children.Add(head);
        var muzzle = new Ellipse { Width = 18, Height = 13, Fill = M("#E6E6EC") };
        Canvas.SetLeft(muzzle, 25); Canvas.SetTop(muzzle, 32); c.Children.Add(muzzle);
        var mask = new Path { Fill = M("#2C2C38"), Data = Geometry.Parse("M 18,24 Q 34,32 50,24 Q 34,30 18,24 Z") };
        c.Children.Add(mask);
        var eyeL = new Ellipse { Width = 5, Height = 4, Fill = Brushes.White };
        Canvas.SetLeft(eyeL, 24); Canvas.SetTop(eyeL, 25); c.Children.Add(eyeL);
        var eyeR = new Ellipse { Width = 5, Height = 4, Fill = Brushes.White };
        Canvas.SetLeft(eyeR, 42); Canvas.SetTop(eyeR, 25); c.Children.Add(eyeR);
        var pupilL = new Ellipse { Width = 2.2, Height = 2.6, Fill = M("#0B0B14") };
        Canvas.SetLeft(pupilL, 26); Canvas.SetTop(pupilL, 25.5); c.Children.Add(pupilL);
        var pupilR = new Ellipse { Width = 2.2, Height = 2.6, Fill = M("#0B0B14") };
        Canvas.SetLeft(pupilR, 44); Canvas.SetTop(pupilR, 25.5); c.Children.Add(pupilR);
        var nose = new Ellipse { Width = 4, Height = 3, Fill = M("#0B0B14") };
        Canvas.SetLeft(nose, 32); Canvas.SetTop(nose, 36); c.Children.Add(nose);

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Rectangle { Width = 4, Height = 20, Fill = M("#8C929E"), RadiusX = 2, RadiusY = 2, RenderTransform = new RotateTransform(35), RenderTransformOrigin = new Point(0.5, 1) });
            Canvas.SetLeft(pc.Children[pc.Children.Count - 1], 4); Canvas.SetTop(pc.Children[pc.Children.Count - 1], 8);
            pc.Children.Add(new Ellipse { Width = 12, Height = 12, Fill = M("#8C929E") });
            Canvas.SetLeft(pc.Children[pc.Children.Count - 1], -2); Canvas.SetTop(pc.Children[pc.Children.Count - 1], 0);
            pc.Children.Add(new Ellipse { Width = 5, Height = 5, Fill = M("#2C2C38") });
            Canvas.SetLeft(pc.Children[pc.Children.Count - 1], 1.5); Canvas.SetTop(pc.Children[pc.Children.Count - 1], 3.5);
        });
        return (FinishMascot(c, prop), rot);
    }

    // ── 6. Doomquack — a black crow trailing his own personal storm cloud, brandishing a
    // broken umbrella that never actually keeps the rain off.
    public static (FrameworkElement, RotateTransform) BuildDoomquackMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        var cloud1 = new Ellipse { Width = 22, Height = 14, Fill = M("#45475A") };
        Canvas.SetLeft(cloud1, 8); Canvas.SetTop(cloud1, 8); c.Children.Add(cloud1);
        var cloud2 = new Ellipse { Width = 18, Height = 12, Fill = M("#585B70") };
        Canvas.SetLeft(cloud2, 22); Canvas.SetTop(cloud2, 4); c.Children.Add(cloud2);
        c.Children.Add(new Path { Stroke = M("#89B4FA"), StrokeThickness = 1.6, Data = Geometry.Parse("M 14,22 L 11,28 M 22,22 L 19,28 M 30,22 L 27,28") });
        var body = new Ellipse { Width = 30, Height = 26, Fill = M("#2C2C38") };
        Canvas.SetLeft(body, 14); Canvas.SetTop(body, 26); c.Children.Add(body);
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(14, 34), new Point(4, 38), new Point(14, 42) }, Fill = M("#F9A825") });
        var eyeL = new Ellipse { Width = 5, Height = 5, Fill = M("#F38BA8") };
        Canvas.SetLeft(eyeL, 20); Canvas.SetTop(eyeL, 32); c.Children.Add(eyeL);
        var pupilL = new Ellipse { Width = 2.2, Height = 2.2, Fill = M("#0B0B14") };
        Canvas.SetLeft(pupilL, 21.4); Canvas.SetTop(pupilL, 33.4); c.Children.Add(pupilL);

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Rectangle { Width = 2.5, Height = 30, Fill = M("#2C2C38") });
            Canvas.SetLeft(pc.Children[pc.Children.Count - 1], 4);
            pc.Children.Add(new Path { Fill = M("#3B3B4A"), Data = Geometry.Parse("M -6,4 Q 5,-6 16,4 Q 10,0 5,4 Q 0,0 -6,4 Z") });
        });
        return (FinishMascot(c, prop), rot);
    }

    // ── 7. Snaggletooth — a lumpy brown troll sitting on (and endlessly re-tangling) a
    // ball of cable, mismatched fangs jutting from a lopsided grin.
    public static (FrameworkElement, RotateTransform) BuildSnaggletoothMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        var earL = new Ellipse { Width = 10, Height = 14, Fill = M("#8A6A4F") };
        Canvas.SetLeft(earL, 14); Canvas.SetTop(earL, 22); c.Children.Add(earL);
        var earR = new Ellipse { Width = 10, Height = 14, Fill = M("#8A6A4F") };
        Canvas.SetLeft(earR, 50); Canvas.SetTop(earR, 22); c.Children.Add(earR);
        var head = new Ellipse { Width = 38, Height = 32, Fill = M("#A8825E") };
        Canvas.SetLeft(head, 16); Canvas.SetTop(head, 16); c.Children.Add(head);
        var browL = new Path { Stroke = M("#4A3627"), StrokeThickness = 2.5, StrokeStartLineCap = PenLineCap.Round, Data = Geometry.Parse("M 22,26 L 32,29") };
        var browR = new Path { Stroke = M("#4A3627"), StrokeThickness = 2.5, StrokeStartLineCap = PenLineCap.Round, Data = Geometry.Parse("M 48,26 L 38,29") };
        c.Children.Add(browL); c.Children.Add(browR);
        var eyeL = new Ellipse { Width = 4.5, Height = 3, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeL, 23); Canvas.SetTop(eyeL, 30); c.Children.Add(eyeL);
        var eyeR = new Ellipse { Width = 4.5, Height = 3, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeR, 44); Canvas.SetTop(eyeR, 30); c.Children.Add(eyeR);
        var mouth = new Path { Stroke = M("#4A3627"), StrokeThickness = 2, Data = Geometry.Parse("M 24,40 Q 34,45 46,38") };
        c.Children.Add(mouth);
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(26, 40), new Point(24, 47), new Point(30, 41) }, Fill = Brushes.Ivory });
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(40, 39), new Point(41, 44), new Point(45, 38) }, Fill = Brushes.Ivory });

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Rectangle { Width = 2.5, Height = 20, Fill = M("#5B4632") });
            Canvas.SetLeft(pc.Children[pc.Children.Count - 1], 4); Canvas.SetTop(pc.Children[pc.Children.Count - 1], 14);
            var ball = new Ellipse { Width = 20, Height = 20, Fill = M("#1E1E2E") };
            Canvas.SetLeft(ball, -4); Canvas.SetTop(ball, -6);
            pc.Children.Add(ball);
            pc.Children.Add(new Path { Stroke = M("#F38BA8"), StrokeThickness = 1.3, Data = Geometry.Parse("M -2,0 Q 8,4 4,10 Q 12,8 10,14 Q 4,10 6,4") });
        });
        return (FinishMascot(c, prop), rot);
    }

    // ── 8. Redtape — a pale bureaucrat gremlin bound in his own red ribbon, clutching a
    // "DENIED" rubber stamp.
    public static (FrameworkElement, RotateTransform) BuildRedtapeMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        var body = new Ellipse { Width = 30, Height = 40, Fill = M("#C9CDDB") };
        Canvas.SetLeft(body, 18); Canvas.SetTop(body, 16); c.Children.Add(body);
        for (int i = 0; i < 4; i++)
        {
            var wrap = new Rectangle { Width = 34, Height = 5, Fill = M("#E64553"), RadiusX = 2, RadiusY = 2, RenderTransform = new RotateTransform(-14 + i * 4) };
            Canvas.SetLeft(wrap, 16); Canvas.SetTop(wrap, 20 + i * 8);
            c.Children.Add(wrap);
        }
        var head = new Ellipse { Width = 22, Height = 20, Fill = M("#DADEE8") };
        Canvas.SetLeft(head, 22); Canvas.SetTop(head, 10); c.Children.Add(head);
        var eyeL = new Ellipse { Width = 4, Height = 4.6, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeL, 27); Canvas.SetTop(eyeL, 17); c.Children.Add(eyeL);
        var eyeR = new Ellipse { Width = 4, Height = 4.6, Fill = M("#0B0B14") };
        Canvas.SetLeft(eyeR, 37); Canvas.SetTop(eyeR, 17); c.Children.Add(eyeR);
        var mouth = new Path { Stroke = M("#0B0B14"), StrokeThickness = 1.6, Data = Geometry.Parse("M 28,25 L 36,25") };
        c.Children.Add(mouth);

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Rectangle { Width = 3, Height = 18, Fill = M("#5B4632") });
            Canvas.SetLeft(pc.Children[pc.Children.Count - 1], 4); Canvas.SetTop(pc.Children[pc.Children.Count - 1], 16);
            var stampHead = new Border { Width = 22, Height = 16, Background = M("#E64553"), CornerRadius = new CornerRadius(3), BorderBrush = Brushes.White, BorderThickness = new Thickness(1.5) };
            stampHead.Child = new TextBlock { Text = "DENIED", FontSize = 5.5, FontWeight = FontWeights.Black, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 5, 0, 0) };
            Canvas.SetLeft(stampHead, -4); Canvas.SetTop(stampHead, -2);
            pc.Children.Add(stampHead);
        });
        return (FinishMascot(c, prop), rot);
    }

    // ── 9. Bramblebeast — a snarled thorn-bush creature that snags whatever brushes past it.
    public static (FrameworkElement, RotateTransform) BuildBramblebeastMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        var body = new Ellipse { Width = 36, Height = 32, Fill = M("#4E7B3A") };
        Canvas.SetLeft(body, 16); Canvas.SetTop(body, 22); c.Children.Add(body);
        for (int i = 0; i < 8; i++)
        {
            double ang = i * 45 * Math.PI / 180;
            var thorn = new Polygon
            {
                Points = new PointCollection { new Point(34, 38), new Point(34 + Math.Cos(ang) * 22, 38 + Math.Sin(ang) * 22 - 3), new Point(34 + Math.Cos(ang) * 22, 38 + Math.Sin(ang) * 22 + 3) },
                Fill = M("#3A5C2A")
            };
            c.Children.Add(thorn);
        }
        var eyeL = new Ellipse { Width = 6, Height = 7, Fill = M("#F9E2AF") };
        Canvas.SetLeft(eyeL, 24); Canvas.SetTop(eyeL, 32); c.Children.Add(eyeL);
        var pupilL = new Ellipse { Width = 2.6, Height = 3.4, Fill = M("#0B0B14") };
        Canvas.SetLeft(pupilL, 26.5); Canvas.SetTop(pupilL, 34); c.Children.Add(pupilL);
        var eyeR = new Ellipse { Width = 6, Height = 7, Fill = M("#F9E2AF") };
        Canvas.SetLeft(eyeR, 40); Canvas.SetTop(eyeR, 32); c.Children.Add(eyeR);
        var pupilR = new Ellipse { Width = 2.6, Height = 3.4, Fill = M("#0B0B14") };
        Canvas.SetLeft(pupilR, 42.5); Canvas.SetTop(pupilR, 34); c.Children.Add(pupilR);
        var mouth = new Path { Fill = M("#2A4520"), Data = Geometry.Parse("M 26,42 Q 34,50 42,42 Z") };
        c.Children.Add(mouth);

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Path { Stroke = M("#4E7B3A"), StrokeThickness = 3.5, StrokeStartLineCap = PenLineCap.Round, Data = Geometry.Parse("M 8,42 Q 2,24 12,4") });
            for (int i = 0; i < 5; i++)
                pc.Children.Add(new Polygon { Points = new PointCollection { new Point(5 + i, 38 - i * 7), new Point(10 + i, 36 - i * 7), new Point(5 + i, 34 - i * 7) }, Fill = M("#3A5C2A") });
        });
        return (FinishMascot(c, prop), rot);
    }

    // ── 10. Glitch — a gremlin whose head is a flickering static-noise screen, always
    // one bad frame from a crash. Swings a cracked little monitor.
    public static (FrameworkElement, RotateTransform) BuildGlitchMascot()
    {
        var c = new Canvas { Width = 74, Height = 64 };
        var body = new Ellipse { Width = 26, Height = 22, Fill = M("#585B70") };
        Canvas.SetLeft(body, 24); Canvas.SetTop(body, 38); c.Children.Add(body);
        var head = new Rectangle { Width = 34, Height = 28, Fill = M("#1E1E2E"), RadiusX = 4, RadiusY = 4, Stroke = M("#94E2D5"), StrokeThickness = 1.5 };
        Canvas.SetLeft(head, 20); Canvas.SetTop(head, 12); c.Children.Add(head);
        var rng = new Random(7);
        for (int i = 0; i < 22; i++)
        {
            var px = new Rectangle { Width = 3, Height = 3, Fill = rng.Next(2) == 0 ? M("#94E2D5") : M("#3A3A4A") };
            Canvas.SetLeft(px, 21 + rng.Next(30)); Canvas.SetTop(px, 13 + rng.Next(24));
            c.Children.Add(px);
        }
        var eyeL = new Rectangle { Width = 6, Height = 5, Fill = M("#F38BA8") };
        Canvas.SetLeft(eyeL, 26); Canvas.SetTop(eyeL, 20); c.Children.Add(eyeL);
        var eyeR = new Rectangle { Width = 6, Height = 5, Fill = M("#F38BA8") };
        Canvas.SetLeft(eyeR, 40); Canvas.SetTop(eyeR, 24); c.Children.Add(eyeR);

        var (prop, rot) = BuildSwingProp(pc =>
        {
            pc.Children.Add(new Rectangle { Width = 3, Height = 20, Fill = M("#5B4632") });
            Canvas.SetLeft(pc.Children[pc.Children.Count - 1], 4); Canvas.SetTop(pc.Children[pc.Children.Count - 1], 14);
            var monitor = new Border { Width = 20, Height = 15, Background = M("#1E1E2E"), BorderBrush = M("#94E2D5"), BorderThickness = new Thickness(1.5), CornerRadius = new CornerRadius(2) };
            Canvas.SetLeft(monitor, -3); Canvas.SetTop(monitor, -2);
            pc.Children.Add(monitor);
            pc.Children.Add(new Path { Stroke = M("#F38BA8"), StrokeThickness = 1, Data = Geometry.Parse("M -1,-1 L 8,4 M 4,-2 L 15,10") });
        });
        return (FinishMascot(c, prop), rot);
    }

    /// <summary>All 10 real Negative mascots, keyed for logging/rotation.</summary>
    public static readonly List<MeanCritterInfo> MeanCritterPool = new()
    {
        new() { Id = "kilowatt", Name = "Kilowatt", Build = BuildKilowattMascot },
        new() { Id = "dustdevil", Name = "Dustdevil", Build = BuildDustdevilMascot },
        new() { Id = "sirblocksalot", Name = "Sir Blocksalot", Build = BuildSirBlocksalotMascot },
        new() { Id = "grudge", Name = "Grudge", Build = BuildGrudgeMascot },
        new() { Id = "wrenchfiend", Name = "Wrenchfiend", Build = BuildWrenchfiendMascot },
        new() { Id = "doomquack", Name = "Doomquack", Build = BuildDoomquackMascot },
        new() { Id = "snaggletooth", Name = "Snaggletooth", Build = BuildSnaggletoothMascot },
        new() { Id = "redtape", Name = "Redtape", Build = BuildRedtapeMascot },
        new() { Id = "bramblebeast", Name = "Bramblebeast", Build = BuildBramblebeastMascot },
        new() { Id = "glitch", Name = "Glitch", Build = BuildGlitchMascot },
    };
}

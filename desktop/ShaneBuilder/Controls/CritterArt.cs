using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace ShaneBuilder;

// Ported from desktop/BuildConsole/Controls/BuildQueuePanel.xaml.cs (the panel's
// CreateCuteXVector "which face shows on a queue card" builders) for Git #2180 —
// extracted standalone, without dragging BuildQueuePanel's own unrelated panel
// logic along. Real critter art only; not wired to any panel/trigger here.
public static class CritterArt
{
    public enum CritterMood
    {
        Normal,
        Running,
        WaitingForInput,
        Blocked,
        Done,
        Failed,
        Verifying
    }

    private static SolidColorBrush HexBrush(string hex) =>
        new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

    internal static void AddQueueEye(Canvas c, double cx, double cy, Brush color, double w = 3.5, double h = 4.5)
    {
        var eye = new Ellipse { Width = w, Height = h, Fill = color };
        Canvas.SetLeft(eye, cx - w / 2); Canvas.SetTop(eye, cy - h / 2);
        c.Children.Add(eye);
        var hi = new Ellipse { Width = 1.3, Height = 1.3, Fill = Brushes.White };
        Canvas.SetLeft(hi, cx - w / 2 + 1); Canvas.SetTop(hi, cy - h / 2 + 0.6);
        c.Children.Add(hi);
    }

    internal static void AddQueueEyePairMood(Canvas c, CritterMood mood, double lx, double rx, double cy, Brush color)
    {
        if (mood == CritterMood.Blocked)
        {
            c.Children.Add(new Path { Data = Geometry.Parse($"M{lx - 2},{cy - 1} Q{lx + 0.2},{cy + 2} {lx + 2.5},{cy - 1}"), Stroke = color, StrokeThickness = 1.4 });
            c.Children.Add(new Path { Data = Geometry.Parse($"M{rx - 2},{cy - 1} Q{rx + 0.2},{cy + 2} {rx + 2.5},{cy - 1}"), Stroke = color, StrokeThickness = 1.4 });
        }
        else if (mood == CritterMood.Done)
        {
            c.Children.Add(new Path { Data = Geometry.Parse($"M{lx - 2},{cy + 1} Q{lx + 0.2},{cy - 2} {lx + 2.5},{cy + 1}"), Stroke = color, StrokeThickness = 1.4 });
            c.Children.Add(new Path { Data = Geometry.Parse($"M{rx - 2},{cy + 1} Q{rx + 0.2},{cy - 2} {rx + 2.5},{cy + 1}"), Stroke = color, StrokeThickness = 1.4 });
        }
        else
        {
            AddQueueEye(c, lx, cy, color);
            AddQueueEye(c, rx, cy, color);
        }
    }

    internal static void AddQueueBlush(Canvas c, double lx, double rx, double cy, Brush color)
    {
        var bL = new Ellipse { Width = 4.5, Height = 2.5, Fill = color, Opacity = 0.6 };
        Canvas.SetLeft(bL, lx); Canvas.SetTop(bL, cy);
        c.Children.Add(bL);
        var bR = new Ellipse { Width = 4.5, Height = 2.5, Fill = color, Opacity = 0.6 };
        Canvas.SetLeft(bR, rx); Canvas.SetTop(bR, cy);
        c.Children.Add(bR);
    }

    public static Canvas CreateCutePandaVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        var earL = new Ellipse { Width = 9, Height = 9, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(earL, 3); Canvas.SetTop(earL, 2); c.Children.Add(earL);
        var earR = new Ellipse { Width = 9, Height = 9, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(earR, 24); Canvas.SetTop(earR, 2); c.Children.Add(earR);
        var head = new Ellipse { Width = 26, Height = 20, Fill = HexBrush("#F8FAFC") };
        Canvas.SetLeft(head, 5); Canvas.SetTop(head, 7); c.Children.Add(head);
        var patchL = new Ellipse { Width = 9, Height = 11, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(patchL, 7.5); Canvas.SetTop(patchL, 11); c.Children.Add(patchL);
        var patchR = new Ellipse { Width = 9, Height = 11, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(patchR, 19.5); Canvas.SetTop(patchR, 11); c.Children.Add(patchR);
        AddQueueEyePairMood(c, mood, 12, 24, 16, Brushes.White);
        var nose = new Ellipse { Width = 3, Height = 2.2, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 20); c.Children.Add(nose);
        var bamboo = new Rectangle { Width = 3, Height = 12, Fill = HexBrush("#A3E635"), RadiusX = 1.5, RadiusY = 1.5 };
        Canvas.SetLeft(bamboo, 30); Canvas.SetTop(bamboo, 12); c.Children.Add(bamboo);
        AddQueueBlush(c, 6.5, 25.5, 18, HexBrush("#F472B6"));
        return c;
    }

    public static Canvas CreateCuteOtterVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        var earL = new Ellipse { Width = 6, Height = 6, Fill = HexBrush("#A87C4F") };
        Canvas.SetLeft(earL, 6); Canvas.SetTop(earL, 5); c.Children.Add(earL);
        var earR = new Ellipse { Width = 6, Height = 6, Fill = HexBrush("#A87C4F") };
        Canvas.SetLeft(earR, 26); Canvas.SetTop(earR, 5); c.Children.Add(earR);
        var head = new Ellipse { Width = 27, Height = 21, Fill = HexBrush("#C79A63") };
        Canvas.SetLeft(head, 4.5); Canvas.SetTop(head, 8); c.Children.Add(head);
        var muzzle = new Ellipse { Width = 15, Height = 11, Fill = HexBrush("#F2E2C8") };
        Canvas.SetLeft(muzzle, 10.5); Canvas.SetTop(muzzle, 16); c.Children.Add(muzzle);
        AddQueueEyePairMood(c, mood, 13, 25, 17, HexBrush("#1E1E2E"));
        var nose = new Ellipse { Width = 4, Height = 3, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(nose, 16); Canvas.SetTop(nose, 19.5); c.Children.Add(nose);
        var shell = new Ellipse { Width = 9, Height = 7, Fill = HexBrush("#94E2D5") };
        Canvas.SetLeft(shell, 14); Canvas.SetTop(shell, 24); c.Children.Add(shell);
        AddQueueBlush(c, 7, 25, 20, HexBrush("#F472B6"));
        return c;
    }

    public static Canvas CreateCuteHedgehogVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        for (int i = 0; i < 5; i++)
            c.Children.Add(new Polygon { Points = new PointCollection { new Point(4 + i * 5.5, 12), new Point(6.5 + i * 5.5, 1), new Point(9 + i * 5.5, 12) }, Fill = HexBrush("#C77B4D") });
        var head = new Ellipse { Width = 24, Height = 19, Fill = HexBrush("#E8A876") };
        Canvas.SetLeft(head, 6); Canvas.SetTop(head, 9); c.Children.Add(head);
        var muzzle = new Ellipse { Width = 12, Height = 8, Fill = HexBrush("#FCEEDD") };
        Canvas.SetLeft(muzzle, 12); Canvas.SetTop(muzzle, 17); c.Children.Add(muzzle);
        AddQueueEyePairMood(c, mood, 16, 26, 17, HexBrush("#1E1E2E"));
        var nose = new Ellipse { Width = 3, Height = 2.4, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 20.5); c.Children.Add(nose);
        AddQueueBlush(c, 8, 26, 19, HexBrush("#F472B6"));
        return c;
    }

    public static Canvas CreateCuteOwlVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(9, 8), new Point(6, 0), new Point(13, 6) }, Fill = HexBrush("#5EAA8C") });
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(27, 8), new Point(30, 0), new Point(23, 6) }, Fill = HexBrush("#5EAA8C") });
        var body = new Ellipse { Width = 26, Height = 24, Fill = HexBrush("#7FC4A6") };
        Canvas.SetLeft(body, 5); Canvas.SetTop(body, 5); c.Children.Add(body);
        var faceL = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#F5F0DD") };
        Canvas.SetLeft(faceL, 7); Canvas.SetTop(faceL, 10); c.Children.Add(faceL);
        var faceR = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#F5F0DD") };
        Canvas.SetLeft(faceR, 18); Canvas.SetTop(faceR, 10); c.Children.Add(faceR);
        AddQueueEyePairMood(c, mood, 12.5, 23.5, 16, HexBrush("#1E1E2E"));
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(15.5, 19), new Point(20.5, 19), new Point(18, 23) }, Fill = HexBrush("#F59E0B") });
        return c;
    }

    public static Canvas CreateCuteSealVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        var body = new Ellipse { Width = 26, Height = 20, Fill = HexBrush("#B8C6DB") };
        Canvas.SetLeft(body, 5); Canvas.SetTop(body, 8); c.Children.Add(body);
        var muzzle = new Ellipse { Width = 13, Height = 9, Fill = HexBrush("#E8EEF6") };
        Canvas.SetLeft(muzzle, 11.5); Canvas.SetTop(muzzle, 16); c.Children.Add(muzzle);
        AddQueueEyePairMood(c, mood, 14, 24, 16, HexBrush("#1E1E2E"));
        var nose = new Ellipse { Width = 3.5, Height = 2.6, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 19); c.Children.Add(nose);
        c.Children.Add(new Path { Data = Geometry.Parse("M12,21 L4,19 M12,23 L4,24 M22,21 L30,19 M22,23 L30,24"), Stroke = HexBrush("#8FA3C2"), StrokeThickness = 0.8 });
        var flipper = new Ellipse { Width = 8, Height = 5, Fill = HexBrush("#9FB0CC") };
        Canvas.SetLeft(flipper, 2); Canvas.SetTop(flipper, 22); c.Children.Add(flipper);
        AddQueueBlush(c, 7, 25, 19, HexBrush("#F472B6"));
        return c;
    }

    public static Canvas CreateCuteRaccoonVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        var earL = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#6B6B78") };
        Canvas.SetLeft(earL, 4); Canvas.SetTop(earL, 3); c.Children.Add(earL);
        var earR = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#6B6B78") };
        Canvas.SetLeft(earR, 24); Canvas.SetTop(earR, 3); c.Children.Add(earR);
        var head = new Ellipse { Width = 25, Height = 19, Fill = HexBrush("#8E8E9E") };
        Canvas.SetLeft(head, 5.5); Canvas.SetTop(head, 8); c.Children.Add(head);
        var mask = new Path { Fill = HexBrush("#33333F"), Data = Geometry.Parse("M8,13 Q18,20 28,13 Q18,18 8,13 Z") };
        c.Children.Add(mask);
        AddQueueEyePairMood(c, mood, 13, 23, 15, Brushes.White);
        var nose = new Ellipse { Width = 3.5, Height = 2.6, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 19.5); c.Children.Add(nose);
        c.Children.Add(new Rectangle { Width = 4, Height = 3, Fill = HexBrush("#1E1E2E") });
        Canvas.SetLeft(c.Children[c.Children.Count - 1], 15); Canvas.SetTop(c.Children[c.Children.Count - 1], 24);
        c.Children.Add(new Rectangle { Width = 4, Height = 3, Fill = HexBrush("#E8E8EE") });
        Canvas.SetLeft(c.Children[c.Children.Count - 1], 19); Canvas.SetTop(c.Children[c.Children.Count - 1], 24);
        return c;
    }

    public static Canvas CreateCuteHamsterVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        var earL = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#E8B563") };
        Canvas.SetLeft(earL, 4); Canvas.SetTop(earL, 3); c.Children.Add(earL);
        var earR = new Ellipse { Width = 8, Height = 8, Fill = HexBrush("#E8B563") };
        Canvas.SetLeft(earR, 24); Canvas.SetTop(earR, 3); c.Children.Add(earR);
        var head = new Ellipse { Width = 27, Height = 22, Fill = HexBrush("#F2C77E") };
        Canvas.SetLeft(head, 4.5); Canvas.SetTop(head, 7); c.Children.Add(head);
        var cheekL = new Ellipse { Width = 11, Height = 9, Fill = HexBrush("#FCE3B0") };
        Canvas.SetLeft(cheekL, 2); Canvas.SetTop(cheekL, 16); c.Children.Add(cheekL);
        var cheekR = new Ellipse { Width = 11, Height = 9, Fill = HexBrush("#FCE3B0") };
        Canvas.SetLeft(cheekR, 23); Canvas.SetTop(cheekR, 16); c.Children.Add(cheekR);
        AddQueueEyePairMood(c, mood, 13, 23, 16, HexBrush("#1E1E2E"));
        var nose = new Ellipse { Width = 3, Height = 2.2, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(nose, 16.5); Canvas.SetTop(nose, 20); c.Children.Add(nose);
        AddQueueBlush(c, 4, 27, 19, HexBrush("#F472B6"));
        return c;
    }

    public static Canvas CreateCuteFrogVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        var body = new Ellipse { Width = 26, Height = 16, Fill = HexBrush("#7FCB6B") };
        Canvas.SetLeft(body, 5); Canvas.SetTop(body, 13); c.Children.Add(body);
        var bumpL = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#7FCB6B") };
        Canvas.SetLeft(bumpL, 6); Canvas.SetTop(bumpL, 4); c.Children.Add(bumpL);
        var bumpR = new Ellipse { Width = 11, Height = 11, Fill = HexBrush("#7FCB6B") };
        Canvas.SetLeft(bumpR, 19); Canvas.SetTop(bumpR, 4); c.Children.Add(bumpR);
        AddQueueEyePairMood(c, mood, 11.5, 24.5, 9, HexBrush("#1E1E2E"));
        var mouth = new Path { Stroke = HexBrush("#2B6B1F"), StrokeThickness = 1.3, Data = Geometry.Parse("M12,20 Q18,24 24,20") };
        c.Children.Add(mouth);
        var throatPatch = new Ellipse { Width = 12, Height = 5, Fill = HexBrush("#D9F2CE") };
        Canvas.SetLeft(throatPatch, 12); Canvas.SetTop(throatPatch, 21); c.Children.Add(throatPatch);
        return c;
    }

    public static Canvas CreateCuteKoalaVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        var earL = new Ellipse { Width = 13, Height = 13, Fill = HexBrush("#9CA3AF") };
        Canvas.SetLeft(earL, 1); Canvas.SetTop(earL, 4); c.Children.Add(earL);
        var earLin = new Ellipse { Width = 7, Height = 7, Fill = HexBrush("#DCE0E6") };
        Canvas.SetLeft(earLin, 4); Canvas.SetTop(earLin, 7); c.Children.Add(earLin);
        var earR = new Ellipse { Width = 13, Height = 13, Fill = HexBrush("#9CA3AF") };
        Canvas.SetLeft(earR, 22); Canvas.SetTop(earR, 4); c.Children.Add(earR);
        var earRin = new Ellipse { Width = 7, Height = 7, Fill = HexBrush("#DCE0E6") };
        Canvas.SetLeft(earRin, 25); Canvas.SetTop(earRin, 7); c.Children.Add(earRin);
        var head = new Ellipse { Width = 24, Height = 20, Fill = HexBrush("#AEB4BF") };
        Canvas.SetLeft(head, 6); Canvas.SetTop(head, 8); c.Children.Add(head);
        AddQueueEyePairMood(c, mood, 14, 22, 16, HexBrush("#1E1E2E"));
        var nose = new Ellipse { Width = 6, Height = 4.5, Fill = HexBrush("#1E1E2E") };
        Canvas.SetLeft(nose, 15); Canvas.SetTop(nose, 19.5); c.Children.Add(nose);
        AddQueueBlush(c, 7.5, 23, 19, HexBrush("#F472B6"));
        return c;
    }

    public static Canvas CreateCuteChickVector(CritterMood mood)
    {
        var c = new Canvas { Width = 36, Height = 30, ClipToBounds = false };
        var body = new Ellipse { Width = 24, Height = 21, Fill = HexBrush("#FDE047") };
        Canvas.SetLeft(body, 6); Canvas.SetTop(body, 7); c.Children.Add(body);
        var tuft = new Path { Fill = HexBrush("#FDE047"), Data = Geometry.Parse("M16,7 Q14,1 18,3 Q20,-1 21,4 Z") };
        c.Children.Add(tuft);
        AddQueueEyePairMood(c, mood, 14, 24, 15, HexBrush("#1E1E2E"));
        c.Children.Add(new Polygon { Points = new PointCollection { new Point(18, 18), new Point(24, 20), new Point(18, 23) }, Fill = HexBrush("#F97316") });
        var wing = new Ellipse { Width = 9, Height = 12, Fill = HexBrush("#FACC15") };
        Canvas.SetLeft(wing, 6); Canvas.SetTop(wing, 13); c.Children.Add(wing);
        AddQueueBlush(c, 8, 24, 18, HexBrush("#F472B6"));
        return c;
    }
}
